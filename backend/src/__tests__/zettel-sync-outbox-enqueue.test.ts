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
const EVENTS_PATH = '/internal/v1/events'

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

// ── Part-A fixture setup (used only to bootstrap an owner's well-known
// "zettel" folder / a mirrored file - there is no public route to create
// that folder directly) ─────────────────────────────────────────────────

function mirroredEnvelope(ownerUserId: string, payloadOverrides: Record<string, unknown> = {}) {
  return {
    version: '1' as const,
    id: randomUUID(),
    type: 'zettel.note.mirrored.v1',
    source: 'zettel',
    occurredAt: new Date().toISOString(),
    correlationId: randomUUID(),
    payload: {
      noteId: randomUUID(),
      ownerUserId,
      ownerEmail: 'owner@example.com',
      ownerName: 'Owner Name',
      title: 'Bootstrap Note',
      content: 'bootstrap content',
      ...payloadOverrides,
    },
  }
}

function signedEventRequest(env: unknown): RequestInit {
  const body = JSON.stringify(env)
  const source = 'zettel'
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = signNotificationRequest({
    secret: HMAC_SECRET, keyId: HMAC_KEY_ID, source, timestamp, method: 'POST', path: EVENTS_PATH, rawBody: body,
  })
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hof-Service': source,
      'X-Hof-Key-Id': HMAC_KEY_ID,
      'X-Hof-Timestamp': String(timestamp),
      'X-Hof-Signature': signature,
    },
    body,
  }
}

// Establishes the owner's auto-created "zettel" folder by feeding Part A's
// own inbound-event endpoint one mirrored-note event (that event's own
// resulting file is itself a mirrored fixture, useful for the rename/
// delete tests below), then returns its folder id and the note id used.
async function ensureZettelFolder(headers: Record<string, string>, ownerUserId: string) {
  const noteId = randomUUID()
  const res = await app.request(EVENTS_PATH, signedEventRequest(mirroredEnvelope(ownerUserId, { noteId })))
  expect(res.status).toBe(202)
  const rootRes = await get('/folders/root', headers)
  const body = (await rootRes.json()) as FolderView
  const folder = body.folders.find((f) => f.name === 'zettel')
  if (!folder) throw new Error('zettel folder not found at root after mirrored event')
  return { folderId: folder.id, noteId }
}

// ── Ordinary authenticated-route helpers (same conventions as
// files.test.ts / folders.test.ts) ──────────────────────────────────────

interface FolderListEntry { id: string; name: string; parentId: string | null }
interface FileEntry { id: string; name: string }
interface FolderView { folders: FolderListEntry[]; files: FileEntry[] }

const get = (path: string, headers?: Record<string, string>) =>
  headers ? app.request(path, { headers }) : app.request(path)

const patch = (path: string, body: unknown, headers: Record<string, string>) =>
  app.request(path, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const del = (path: string, headers: Record<string, string>) =>
  app.request(path, { method: 'DELETE', headers })

async function createFolder(name: string, parentId: string | null, headers: Record<string, string>) {
  const res = await app.request('/folders', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parentId }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as FolderListEntry
}

function uploadFile(
  headers: Record<string, string>,
  opts: { name: string; content?: string; folderId?: string | null },
) {
  const form = new FormData()
  const content = opts.content ?? 'hello world'
  const file = new File([new Blob([content])], opts.name)
  form.append('file', file)
  if (opts.folderId !== undefined) form.append('folderId', opts.folderId ?? '')
  return app.request('/files', { method: 'POST', headers, body: form })
}

interface OutboxRow {
  id: string
  event_type: string
  owner_user_id: string
  payload: string
  correlation_id: string
  state: string
}

function outboxRows(eventType: string, ownerUserId?: string): OutboxRow[] {
  const rows = ownerUserId
    ? sqlite.prepare('SELECT * FROM zettel_sync_outbox WHERE event_type = ? AND owner_user_id = ?').all(eventType, ownerUserId)
    : sqlite.prepare('SELECT * FROM zettel_sync_outbox WHERE event_type = ?').all(eventType)
  return rows as OutboxRow[]
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('POST /files - schrank.file.zettel_created.v1 enqueueing', () => {
  it('queues exactly one row for a .md upload directly into the zettel folder, with title/content/owner in the payload', async () => {
    const { folderId: zettelFolderId } = await ensureZettelFolder(H1, 'user-1')
    const uploadRes = await uploadFile(H1, { name: 'Shopping List.md', content: '- bread\n- butter', folderId: zettelFolderId })
    expect(uploadRes.status).toBe(201)

    const rows = outboxRows('schrank.file.zettel_created.v1', 'user-1')
    expect(rows).toHaveLength(1)
    const payload = JSON.parse(rows[0]!.payload) as { title: string; content: string }
    expect(payload.title).toBe('Shopping List')
    expect(payload.content).toBe('- bread\n- butter')
    expect(rows[0]!.owner_user_id).toBe('user-1')
  })

  it('queues no such row for a .md upload into an ordinary (non-zettel) folder', async () => {
    await ensureZettelFolder(H1, 'user-1')
    const ordinary = await createFolder('Documents', null, H1)
    const uploadRes = await uploadFile(H1, { name: 'note.md', folderId: ordinary.id })
    expect(uploadRes.status).toBe(201)
    expect(outboxRows('schrank.file.zettel_created.v1')).toHaveLength(0)
  })

  it('queues no such row for a non-.md upload directly into the zettel folder', async () => {
    const { folderId: zettelFolderId } = await ensureZettelFolder(H1, 'user-1')
    const uploadRes = await uploadFile(H1, { name: 'todo.txt', folderId: zettelFolderId })
    expect(uploadRes.status).toBe(201)
    expect(outboxRows('schrank.file.zettel_created.v1')).toHaveLength(0)
  })

  it('queues no such row for an ordinary file uploaded elsewhere (root, no zettel folder involved)', async () => {
    const uploadRes = await uploadFile(H1, { name: 'random.pdf' })
    expect(uploadRes.status).toBe(201)
    expect(outboxRows('schrank.file.zettel_created.v1')).toHaveLength(0)
  })
})

describe('PATCH /files/:id - schrank.file.zettel_renamed.v1 enqueueing', () => {
  it('queues a row with the new title when renaming a mirrored file', async () => {
    const { folderId: zettelFolderId } = await ensureZettelFolder(H1, 'user-1')
    const listing = await get(`/folders/${zettelFolderId}`, H1)
    const body = (await listing.json()) as FolderView
    expect(body.files).toHaveLength(1)
    const mirroredFile = body.files[0]!

    const res = await patch(`/files/${mirroredFile.id}`, { name: 'Renamed Note.md' }, H1)
    expect(res.status).toBe(200)

    const rows = outboxRows('schrank.file.zettel_renamed.v1', 'user-1')
    expect(rows).toHaveLength(1)
    const payload = JSON.parse(rows[0]!.payload) as { title: string }
    expect(payload.title).toBe('Renamed Note')
  })

  it('queues nothing when renaming a file that is not a mirror', async () => {
    const uploadRes = await uploadFile(H1, { name: 'plain.txt' })
    const file = (await uploadRes.json()) as { id: string }
    const res = await patch(`/files/${file.id}`, { name: 'renamed-plain.txt' }, H1)
    expect(res.status).toBe(200)
    expect(outboxRows('schrank.file.zettel_renamed.v1')).toHaveLength(0)
  })

  it('queues nothing when only moving a mirrored file (folderId changes, name unchanged)', async () => {
    const { folderId: zettelFolderId } = await ensureZettelFolder(H1, 'user-1')
    const listing = await get(`/folders/${zettelFolderId}`, H1)
    const body = (await listing.json()) as FolderView
    const mirroredFile = body.files[0]!

    const dest = await createFolder('Elsewhere', null, H1)
    const res = await patch(`/files/${mirroredFile.id}`, { folderId: dest.id }, H1)
    expect(res.status).toBe(200)

    expect(outboxRows('schrank.file.zettel_renamed.v1')).toHaveLength(0)
  })
})

describe('DELETE /files/:id - schrank.file.zettel_deleted.v1 enqueueing', () => {
  it('queues a row with the right noteId and owner when deleting a mirrored file', async () => {
    const { folderId: zettelFolderId, noteId } = await ensureZettelFolder(H1, 'user-1')
    const listing = await get(`/folders/${zettelFolderId}`, H1)
    const body = (await listing.json()) as FolderView
    const mirroredFile = body.files[0]!

    const res = await del(`/files/${mirroredFile.id}`, H1)
    expect(res.status).toBe(200)

    const rows = outboxRows('schrank.file.zettel_deleted.v1', 'user-1')
    expect(rows).toHaveLength(1)
    const payload = JSON.parse(rows[0]!.payload) as { noteId: string }
    expect(payload.noteId).toBe(noteId)
    expect(rows[0]!.owner_user_id).toBe('user-1')
  })

  it('queues nothing when deleting a non-mirrored file', async () => {
    const uploadRes = await uploadFile(H1, { name: 'plain.txt' })
    const file = (await uploadRes.json()) as { id: string }
    const res = await del(`/files/${file.id}`, H1)
    expect(res.status).toBe(200)
    expect(outboxRows('schrank.file.zettel_deleted.v1')).toHaveLength(0)
  })
})

describe('DELETE /folders/:id - recursive schrank.file.zettel_deleted.v1 enqueueing', () => {
  it('queues one row per mirrored descendant file (including one nested two levels deep), and none for non-mirrored descendants', async () => {
    const { folderId: zettelFolderId, noteId: rootNoteId } = await ensureZettelFolder(H1, 'user-1')
    const sub = await createFolder('sub', zettelFolderId, H1)

    // A second mirrored note, then moved two levels deep: zettel/sub/note.md
    const secondNoteId = randomUUID()
    const mirrorRes = await app.request(
      EVENTS_PATH,
      signedEventRequest(mirroredEnvelope('user-1', { noteId: secondNoteId, title: 'Deep Note', content: 'deep content' })),
    )
    expect(mirrorRes.status).toBe(202)

    const listing = await get(`/folders/${zettelFolderId}`, H1)
    const listingBody = (await listing.json()) as FolderView
    const deepFile = listingBody.files.find((f) => f.name.toLowerCase().includes('deep'))
    if (!deepFile) throw new Error('expected the second mirrored file to exist in the zettel folder')
    const moveRes = await patch(`/files/${deepFile.id}`, { folderId: sub.id }, H1)
    expect(moveRes.status).toBe(200)

    // A non-mirrored plain file, also nested two levels deep, to prove
    // only mirrored files are reported.
    const plainUpload = await uploadFile(H1, { name: 'plain.txt', folderId: sub.id })
    expect(plainUpload.status).toBe(201)

    const delRes = await del(`/folders/${zettelFolderId}`, H1)
    expect(delRes.status).toBe(200)

    const rows = outboxRows('schrank.file.zettel_deleted.v1', 'user-1')
    expect(rows).toHaveLength(2)
    const noteIds = rows.map((r) => (JSON.parse(r.payload) as { noteId: string }).noteId).sort()
    expect(noteIds).toEqual([rootNoteId, secondNoteId].sort())
  })
})
