import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { usersRouter } from '../../features/users/router.js'
import { foldersRouter } from '../../features/folders/router.js'
import { filesRouter } from '../../features/files/router.js'
import { usageRouter } from '../../features/usage/router.js'
import { exportsRouter } from '../../features/exports/router.js'
import { requireAuth, requireAdmin } from '../../middleware/auth.js'
import { openApiDocument } from '../../openapi.js'
import { MAX_FILE_BYTES } from '../../lib/quota.js'
import { syncInboxRouter } from '../../sync/inbox.js'

/**
 * Build a minimal Hono app wired up with the real routers plus the
 * inline /health, /ready, and /openapi.json routes that index.ts itself
 * defines. Those are reconstructed here rather than importing index.ts
 * directly, since index.ts eagerly runs drizzle's migrate() against the
 * db module at import time (which would blow up against helpers/db.ts's
 * already-migrated in-memory db) and, as the real entrypoint, also
 * starts an HTTP listener as a side effect.
 *
 * The db and auth modules are expected to have been mocked by the calling
 * test file (via vi.mock('../db/index.js', ...) and
 * vi.mock('../middleware/auth.js', ...)) before this function is called.
 */
export function createTestApp() {
  const app = new Hono()
  // Mirrors index.ts's real middleware stack, not just the routers - so
  // this exact behavior (body-size limiting) is exercised in tests too.
  app.use(
    '*',
    bodyLimit({
      maxSize: MAX_FILE_BYTES + 1024 * 1024,
      onError: (c) => c.json({ error: 'Request body too large' }, 413),
    }),
  )
  app.get('/health', (c) => c.json({ status: 'ok', service: 'Schrank' }))
  app.get('/ready', (c) => c.json({ status: 'ready', service: 'Schrank' }))
  app.get('/openapi.json', requireAuth, requireAdmin, (c) => c.json(openApiDocument))
  app.route('/users', usersRouter)
  app.route('/folders', foldersRouter)
  app.route('/files', filesRouter)
  app.route('/usage', usageRouter)
  app.route('/exports', exportsRouter)
  app.route('/internal/v1', syncInboxRouter)
  return app
}
