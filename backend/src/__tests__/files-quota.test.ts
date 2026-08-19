// Dedicated file for quota (413) testing. lib/quota.ts reads MAX_FILE_BYTES
// and MAX_BYTES_PER_USER from process.env once at module-load time, so these
// overrides must land before any import that could transitively load it -
// and must live in their own test FILE (this project's vitest config uses
// pool: 'forks', so each test file gets its own process/module registry and
// this override can't leak into any other test file).
process.env['MAX_FILE_BYTES'] = '100'
process.env['MAX_BYTES_PER_USER'] = '250'

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../db/index.js', async () => await import('./helpers/db.js'))
vi.mock('../middleware/auth.js', async () => await import('./helpers/auth-mock.js'))

// IMPORTANT: these must be dynamic imports, not static ones. Static `import`
// statements are hoisted and evaluated before ANY other top-level code in
// this module - including the process.env assignments above, even though
// they're written first - which would let lib/quota.ts read the *default*
// env values before our overrides ever ran. A dynamic import() executes
// exactly where it appears in program order, so it correctly runs after the
// overrides above.
const { sqlite, cleanDb } = await import('./helpers/db.js')
const { createTestApp } = await import('./helpers/setup.js')

const app = createTestApp()

const H1 = { Authorization: 'Bearer test-token' }
const H2 = { Authorization: 'Bearer user2-token' }

function wipeDb() {
  cleanDb()
  sqlite.exec('DELETE FROM files')
  sqlite.exec('DELETE FROM folders')
}

beforeEach(() => wipeDb())

interface FileDTO {
  id: string
  sizeBytes: number
}

function uploadFile(headers: Record<string, string>, name: string, sizeBytes: number) {
  const bytes = new Uint8Array(sizeBytes).fill(65)
  const form = new FormData()
  form.append('file', new File([bytes], name, { type: 'application/octet-stream' }))
  return app.request('/files', { method: 'POST', headers, body: form })
}

describe('storage quota (413)', () => {
  it('413 when a single file exceeds MAX_FILE_BYTES', async () => {
    const res = await uploadFile(H1, 'big.bin', 101)
    expect(res.status).toBe(413)
  })

  it('a file at or under MAX_FILE_BYTES is accepted', async () => {
    const res = await uploadFile(H1, 'ok.bin', 100)
    expect(res.status).toBe(201)
  })

  it('413 when a second, individually-small file would push total usage over MAX_BYTES_PER_USER', async () => {
    const first = await uploadFile(H1, 'first.bin', 90)
    expect(first.status).toBe(201)
    const firstBody = (await first.json()) as FileDTO
    expect(firstBody.sizeBytes).toBe(90)

    // 90 (already stored) + 90 (new, itself well under the 100-byte per-file
    // cap) = 180, still under 250 -> should succeed.
    const second = await uploadFile(H1, 'second.bin', 90)
    expect(second.status).toBe(201)

    // 90 + 90 + 90 = 270 > 250 -> should be rejected even though 90 < 100.
    const third = await uploadFile(H1, 'third.bin', 90)
    expect(third.status).toBe(413)
  })

  it("a different user's usage never counts against the first user's quota", async () => {
    const mine = await uploadFile(H1, 'mine.bin', 90)
    expect(mine.status).toBe(201)

    // user-2 has used nothing yet, so their own upload near the per-user cap
    // must succeed regardless of what user-1 has stored.
    const theirs = await uploadFile(H2, 'theirs.bin', 90)
    expect(theirs.status).toBe(201)

    // user-1 should still be able to use their remaining quota (90 used,
    // 250 cap -> 160 left), independent of user-2's usage.
    const mineAgain = await uploadFile(H1, 'mine2.bin', 90)
    expect(mineAgain.status).toBe(201)
  })
})
