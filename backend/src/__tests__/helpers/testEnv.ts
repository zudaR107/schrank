import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// lib/storage.ts reads DATA_DIR from process.env at module-load time
// (like every other module-level config constant in this backend - see
// db/index.ts's DATABASE_PATH, middleware/auth.ts's JWKS_URL). A vitest
// setupFiles entry runs before a test file's own imports are evaluated,
// so setting this here guarantees storage.ts sees a real, isolated
// per-run temp directory rather than the actual ./data used by `pnpm
// dev` - tests would otherwise write real files into (and potentially
// collide with) local dev data.
process.env['DATA_DIR'] = mkdtempSync(join(tmpdir(), 'schrank-test-'))
