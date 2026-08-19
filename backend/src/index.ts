import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { createCorsMiddleware } from '@zudar107/schloss-server-kit'
import { bodyLimit } from 'hono/body-limit'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { db } from './db/index.js'
import { usersRouter } from './features/users/router.js'
import { foldersRouter } from './features/folders/router.js'
import { filesRouter } from './features/files/router.js'
import { usageRouter } from './features/usage/router.js'
import { exportsRouter } from './features/exports/router.js'
import { requireAuth, requireAdmin } from './middleware/auth.js'
import { openApiDocument } from './openapi.js'
import { MAX_FILE_BYTES } from './lib/quota.js'

// Resolved relative to this file so it works both in dev (src/index.ts,
// migrations at src/db/migrations) and in the compiled build
// (dist/index.js, migrations at dist/db/migrations) without a hardcoded
// path that only matches one of the two.
const __dirname = dirname(fileURLToPath(import.meta.url))

migrate(db, { migrationsFolder: join(__dirname, 'db/migrations') })

const ALLOWED_ORIGINS = (process.env['ALLOWED_ORIGINS'] ?? 'http://localhost:5178')
  .split(',').map((o) => o.trim())

const app = new Hono()

// Sized to the upload route's own per-file quota (plus a small fixed
// overhead for multipart boundaries/headers) rather than the platform's
// usual 1MB JSON-only cap - Schrank's whole purpose is accepting real
// file uploads. Every other route's body is tiny JSON, well under this,
// so one app-wide limit is simpler than juggling a route-scoped
// exception (bodyLimit doesn't compose cleanly across two `app.use`
// registrations matching the same request - the first one to run would
// just reject large uploads before the upload-specific one ever saw them).
app.use('*', bodyLimit({
  maxSize: MAX_FILE_BYTES + 1024 * 1024,
  onError: (c) => c.json({ error: 'Request body too large' }, 413),
}))
app.use('*', logger())
app.use('*', createCorsMiddleware({ allowedOrigins: ALLOWED_ORIGINS }))

app.get('/health', (c) => c.json({ status: 'ok', service: 'Schrank' }))
app.get('/ready', (c) => c.json({ status: 'ready', service: 'Schrank' }))

// Reached from schrank/frontend's own /docs page as /backend/openapi.json
// (the frontend container's Caddyfile already proxies /backend/* here
// with the prefix stripped) - no new reverse-proxy rule needed.
app.get('/openapi.json', requireAuth, requireAdmin, (c) => c.json(openApiDocument))

app.route('/users', usersRouter)
app.route('/folders', foldersRouter)
app.route('/files', filesRouter)
app.route('/usage', usageRouter)
app.route('/exports', exportsRouter)

const PORT = Number(process.env['PORT'] ?? 3005)
const server = serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`[Schrank API] Running on http://localhost:${PORT}`)
})

let shutdownPromise: Promise<void> | undefined
function shutdown(): Promise<void> {
  if (shutdownPromise) return shutdownPromise
  shutdownPromise = new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
  return shutdownPromise
}
process.once('SIGINT', () => shutdown())
process.once('SIGTERM', () => shutdown())

export { app }
