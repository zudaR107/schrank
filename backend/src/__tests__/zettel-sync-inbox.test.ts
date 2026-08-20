import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { signNotificationRequest } from '@zudar107/schloss-server-kit'

vi.mock('../db/index.js', async () => await import('./helpers/db.js'))
vi.mock('../middleware/auth.js', async () => await import('./helpers/auth-mock.js'))

import { sqlite, cleanDb } from './helpers/db.js'
import { createTestApp } from './helpers/setup.js'

const app = createTestApp()

const HMAC_KEY_ID = 'zettel-test'
const HMAC_SECRET = 'test-only-secret-with-at-least-32-bytes'
const PATH = '/internal/v1/events'

const H1 = { Authorization: 'Bearer test-token' } // user-1

function wipeDb() {
  cleanDb()
  sqlite.exec('DELETE FROM files')
  sqlite.exec('DELETE FROM folders')
}

beforeEach(() => {
  wipeDb()
  vi.stubEnv('ZETTEL_TO_SCHRANK_HMAC_KEY_ID', HMAC_KEY_ID)
  vi.stubEnv('ZETTEL_TO_SCHRANK_HMAC_SECRET', HMAC_SECRET)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

interface Envelope {
  version: '1'
  id: string
  type: string
  source: string
  occurredAt: string
  correlationId: string
  payload: Record<string, unknown>
}

function mirroredPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    noteId: randomUUID(),
    ownerUserId: 'user-1',
    ownerEmail: 'test@example.com',
    ownerName: 'Test User',
    title: 'My First Note',
    content: '# Hello world\n\nSome content.',
    ...overrides,
  }
}

function envelope(overrides: Partial<Envelope> = {}): Envelope {
  return {
    version: '1',
    id: randomUUID(),
    type: 'zettel.note.mirrored.v1',
    source: 'zettel',
    occurredAt: new Date().toISOString(),
    correlationId: randomUUID(),
    payload: mirroredPayload(),
    ...overrides,
  }
}

function signedRequest(
  env: unknown,
  opts: { secret?: string; keyId?: string; headerSource?: string; timestamp?: number } = {},
): RequestInit {
  const body = JSON.stringify(env)
  const bodySource = typeof env === 'object' && env !== null && 'source' in env
    ? String((env as Record<string, unknown>)['source'])
    : 'zettel'
  const source = opts.headerSource ?? bodySource
  const keyId = opts.keyId ?? HMAC_KEY_ID
  const secret = opts.secret ?? HMAC_SECRET
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000)
  const signature = signNotificationRequest({
    secret, keyId, source, timestamp, method: 'POST', path: PATH, rawBody: body,
  })
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hof-Service': source,
      'X-Hof-Key-Id': keyId,
      'X-Hof-Timestamp': String(timestamp),
      'X-Hof-Signature': signature,
    },
    body,
  }
}

function post(env: unknown, opts?: Parameters<typeof signedRequest>[1]) {
  return app.request(PATH, signedRequest(env, opts))
}

const get = (path: string, headers?: Record<string, string>) =>
  headers ? app.request(path, { headers }) : app.request(path)

interface FolderListEntry { id: string; name: string }
interface FolderView { folders: FolderListEntry[]; files: { id: string; name: string }[] }

async function findFolder(headers: Record<string, string>, name: string) {
  const res = await get('/folders/root', headers)
  const body = (await res.json()) as FolderView
  const folder = body.folders.find((f) => f.name === name)
  if (!folder) throw new Error(`folder "${name}" not found at root`)
  return folder
}

async function folderContents(headers: Record<string, string>, folderId: string): Promise<FolderView> {
  const res = await get(`/folders/${folderId}`, headers)
  expect(res.status).toBe(200)
  return (await res.json()) as FolderView
}

describe('POST /internal/v1/events - authentication', () => {
  const headerNames = ['X-Hof-Service', 'X-Hof-Key-Id', 'X-Hof-Timestamp', 'X-Hof-Signature']

  it.each(headerNames)('401 when the %s header is missing', async (headerName) => {
    const req = signedRequest(envelope())
    const headers = { ...(req.headers as Record<string, string>) }
    delete headers[headerName]
    const res = await app.request(PATH, { ...req, headers })
    expect(res.status).toBe(401)
  })

  it('401 with a wrong signature (secret mismatch)', async () => {
    const res = await post(envelope(), { secret: 'a-totally-different-secret-with-32-bytes' })
    expect(res.status).toBe(401)
  })

  it('401 when the body is tampered with after signing', async () => {
    const req = signedRequest(envelope())
    const res = await app.request(PATH, { ...req, body: `${req.body as string} ` })
    expect(res.status).toBe(401)
  })
})

describe('POST /internal/v1/events - producer configuration', () => {
  it("403 { error: 'Producer is not configured' } for a source other than zettel", async () => {
    const env = envelope({ source: 'tafel', payload: mirroredPayload() })
    const res = await post(env, { headerSource: 'tafel' })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Producer is not configured' })
  })

  it('403 for an otherwise well-formed, correctly-signed zettel request when the HMAC env vars are unset', async () => {
    vi.unstubAllEnvs()
    const res = await post(envelope())
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Producer is not configured' })
  })
})

describe('POST /internal/v1/events - envelope validation', () => {
  it('400 when id is not a valid UUID', async () => {
    const res = await post(envelope({ id: 'not-a-uuid' }))
    expect(res.status).toBe(400)
  })

  it('400 when correlationId is not a valid UUID', async () => {
    const res = await post(envelope({ correlationId: 'not-a-uuid' }))
    expect(res.status).toBe(400)
  })

  it('400 when the envelope source does not match the X-Hof-Service header', async () => {
    const env = envelope({ source: 'schlussel' })
    const res = await post(env, { headerSource: 'zettel' })
    expect(res.status).toBe(400)
  })

  it("400 { error: 'Invalid event envelope' } for an unrecognized event type", async () => {
    const res = await post(envelope({ type: 'zettel.note.something_else.v1' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid event envelope' })
  })
})

describe('POST /internal/v1/events - body size limit', () => {
  it('413 for a body larger than roughly 2MB', async () => {
    const bigContent = 'x'.repeat(3 * 1024 * 1024)
    const env = envelope({ payload: mirroredPayload({ content: bigContent }) })
    const res = await post(env)
    expect(res.status).toBe(413)
  }, 20_000)
})

describe('POST /internal/v1/events - idempotency', () => {
  it('202 then 200 duplicate for an exact replay, without double-applying the effect', async () => {
    const env = envelope()
    const first = await post(env)
    expect(first.status).toBe(202)
    expect(await first.json()).toEqual({ status: 'accepted' })

    const zettelFolder = await findFolder(H1, 'zettel')
    const before = await folderContents(H1, zettelFolder.id)
    expect(before.files).toHaveLength(1)

    const second = await post(env)
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ status: 'duplicate' })

    const after = await folderContents(H1, zettelFolder.id)
    expect(after.files).toHaveLength(1)
    expect(after.files[0]?.id).toBe(before.files[0]?.id)
  })

  it('409 when the same event id is reused with a different body', async () => {
    const env = envelope()
    expect((await post(env)).status).toBe(202)

    const changed = envelope({ id: env.id, payload: mirroredPayload({ noteId: env.payload['noteId'] as string, title: 'A different title' }) })
    const res = await post(changed)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Event identity conflict' })
  })
})

describe('zettel.note.mirrored.v1', () => {
  it('creates a .md file in the auto-created "zettel" folder with the exact byte content', async () => {
    const noteId = randomUUID()
    const env = envelope({ payload: mirroredPayload({ noteId, title: 'Grocery List', content: '- milk\n- eggs\n' }) })
    const res = await post(env)
    expect(res.status).toBe(202)

    const zettelFolder = await findFolder(H1, 'zettel')
    const contents = await folderContents(H1, zettelFolder.id)
    expect(contents.files).toHaveLength(1)
    const file = contents.files[0]!
    expect(file.name.toLowerCase()).toMatch(/\.md$/)
    expect(file.name.toLowerCase()).toContain('grocery')

    const contentRes = await get(`/files/${file.id}/content`, H1)
    expect(contentRes.status).toBe(200)
    expect(await contentRes.text()).toBe('- milk\n- eggs\n')
  })

  it('updates the same file in place when the same noteId is mirrored again with a different title/content', async () => {
    const noteId = randomUUID()
    await post(envelope({ payload: mirroredPayload({ noteId, title: 'Original Title', content: 'original content' }) }))

    const zettelFolder = await findFolder(H1, 'zettel')
    const before = await folderContents(H1, zettelFolder.id)
    expect(before.files).toHaveLength(1)
    const originalFileId = before.files[0]!.id

    const res = await post(envelope({ payload: mirroredPayload({ noteId, title: 'Renamed Title', content: 'updated content' }) }))
    expect(res.status).toBe(202)

    const after = await folderContents(H1, zettelFolder.id)
    expect(after.files).toHaveLength(1)
    expect(after.files[0]?.id).toBe(originalFileId)

    const contentRes = await get(`/files/${originalFileId}/content`, H1)
    expect(await contentRes.text()).toBe('updated content')
  })

  it('auto-provisions a never-before-seen owner (invented id, own email/name) without a 500/FK failure', async () => {
    const res = await post(envelope({ payload: mirroredPayload({
      ownerUserId: 'user-99', ownerEmail: 'fresh@example.com', ownerName: 'Fresh Owner',
    }) }))
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ status: 'accepted' })

    const row = sqlite.prepare('SELECT id, email, name FROM users WHERE id = ?').get('user-99') as
      | { id: string; email: string; name: string }
      | undefined
    expect(row).toEqual({ id: 'user-99', email: 'fresh@example.com', name: 'Fresh Owner' })
  })

  it('auto-provisions a first-time owner entirely from the event, before that owner has ever authenticated', async () => {
    // users table is wiped every test, so user-1 genuinely has no row yet.
    expect(sqlite.prepare('SELECT id FROM users WHERE id = ?').get('user-1')).toBeUndefined()

    const res = await post(envelope({ payload: mirroredPayload({ ownerUserId: 'user-1' }) }))
    expect(res.status).toBe(202)

    // Now authenticate as that same user id through the ordinary,
    // unrelated auth-mock token mapping and confirm the request succeeds
    // rather than failing on a missing users row.
    const rootRes = await get('/folders/root', H1)
    expect(rootRes.status).toBe(200)
    const body = (await rootRes.json()) as FolderView
    expect(body.folders.some((f) => f.name === 'zettel')).toBe(true)
  })
})

describe('zettel.note.unmirrored.v1', () => {
  it('deletes the file that was mirroring the note', async () => {
    const noteId = randomUUID()
    await post(envelope({ payload: mirroredPayload({ noteId }) }))
    const zettelFolder = await findFolder(H1, 'zettel')
    const before = await folderContents(H1, zettelFolder.id)
    expect(before.files).toHaveLength(1)

    const res = await post(envelope({
      type: 'zettel.note.unmirrored.v1',
      payload: { noteId, ownerUserId: 'user-1' },
    }))
    expect(res.status).toBe(202)

    const after = await folderContents(H1, zettelFolder.id)
    expect(after.files).toHaveLength(0)
  })

  it('is a harmless no-op (2xx, never 404/500) when the noteId was never mirrored', async () => {
    const res = await post(envelope({
      type: 'zettel.note.unmirrored.v1',
      payload: { noteId: randomUUID(), ownerUserId: 'user-1' },
    }))
    expect([200, 202]).toContain(res.status)
  })
})
