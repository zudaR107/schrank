import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../db/index.js', async () => await import('./helpers/db.js'))
vi.mock('../middleware/auth.js', async () => await import('./helpers/auth-mock.js'))

import { sqlite, cleanDb } from './helpers/db.js'
import { createTestApp } from './helpers/setup.js'

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
  name: string
  folderId: string | null
  mimeType: string
  sizeBytes: number
  createdAt: string
  updatedAt: string
}

interface FolderDTO {
  id: string
  name: string
  parentId: string | null
  createdAt: string
}

const get = (path: string, headers?: Record<string, string>) =>
  headers ? app.request(path, { headers }) : app.request(path)

const post = (path: string, body: unknown, headers: Record<string, string>) =>
  app.request(path, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const patch = (path: string, body: unknown, headers: Record<string, string>) =>
  app.request(path, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const del = (path: string, headers: Record<string, string>) =>
  app.request(path, { method: 'DELETE', headers })

async function createFolder(
  name: string,
  parentId: string | null | undefined,
  headers: Record<string, string>,
) {
  const body: Record<string, unknown> = { name }
  if (parentId !== undefined) body['parentId'] = parentId
  const res = await post('/folders', body, headers)
  expect(res.status).toBe(201)
  return (await res.json()) as FolderDTO
}

function uploadFile(
  headers: Record<string, string>,
  opts: { name?: string; content?: BlobPart; type?: string; folderId?: string | null; omitFile?: boolean },
) {
  const form = new FormData()
  if (!opts.omitFile) {
    const content = opts.content ?? 'hello world'
    const blobOpts = opts.type !== undefined ? { type: opts.type } : undefined
    const blob = new Blob([content], blobOpts)
    const file = new File([blob], opts.name ?? 'test.txt', blobOpts)
    form.append('file', file)
  }
  if (opts.folderId !== undefined) form.append('folderId', opts.folderId ?? '')
  return app.request('/files', { method: 'POST', headers, body: form })
}

describe('POST /files', () => {
  it('401 without auth', async () => {
    const form = new FormData()
    form.append('file', new File([new Blob(['x'])], 'a.txt'))
    const res = await app.request('/files', { method: 'POST', body: form })
    expect(res.status).toBe(401)
  })

  it('400 when the file field is missing entirely', async () => {
    const res = await uploadFile(H1, { omitFile: true })
    expect(res.status).toBe(400)
  })

  it("400 when the uploaded file's own name is empty", async () => {
    const res = await uploadFile(H1, { name: '' })
    expect(res.status).toBe(400)
  })

  it('404 when folderId is given but does not exist', async () => {
    const res = await uploadFile(H1, { name: 'a.txt', folderId: 'nonexistent' })
    expect(res.status).toBe(404)
  })

  it("404 when folderId belongs to a different user", async () => {
    const theirs = await createFolder('Theirs', null, H2)
    const res = await uploadFile(H1, { name: 'a.txt', folderId: theirs.id })
    expect(res.status).toBe(404)
  })

  it('201 with metadata: name/mimeType/sizeBytes from the upload, at root when folderId omitted', async () => {
    const res = await uploadFile(H1, { name: 'doc.txt', content: 'hello world', type: 'text/plain' })
    expect(res.status).toBe(201)
    const body = (await res.json()) as FileDTO
    expect(body.name).toBe('doc.txt')
    expect(body.mimeType).toBe('text/plain')
    expect(body.sizeBytes).toBe(new TextEncoder().encode('hello world').length)
    expect(body.folderId).toBeNull()
    expect(typeof body.id).toBe('string')
  })

  it('201 at root when folderId is an empty string', async () => {
    const res = await uploadFile(H1, { name: 'doc.txt', folderId: '' })
    expect(res.status).toBe(201)
    const body = (await res.json()) as FileDTO
    expect(body.folderId).toBeNull()
  })

  it('201 nested inside a real folder', async () => {
    const folder = await createFolder('Docs', null, H1)
    const res = await uploadFile(H1, { name: 'doc.txt', folderId: folder.id })
    expect(res.status).toBe(201)
    const body = (await res.json()) as FileDTO
    expect(body.folderId).toBe(folder.id)
  })

  it('falls back to application/octet-stream when no type is declared', async () => {
    const res = await uploadFile(H1, { name: 'noext', type: '' })
    expect(res.status).toBe(201)
    const body = (await res.json()) as FileDTO
    expect(body.mimeType).toBe('application/octet-stream')
  })

  it('409 when the name collides with an existing file in the same location', async () => {
    await uploadFile(H1, { name: 'dup.txt' })
    const res = await uploadFile(H1, { name: 'dup.txt' })
    expect(res.status).toBe(409)
  })

  it('409 when the name collides with an existing FOLDER in the same location (shared namespace)', async () => {
    await createFolder('SharedName', null, H1)
    const res = await uploadFile(H1, { name: 'SharedName' })
    expect(res.status).toBe(409)
  })

  it('does not 409 across different users with the same name', async () => {
    await uploadFile(H1, { name: 'dup.txt' })
    const res = await uploadFile(H2, { name: 'dup.txt' })
    expect(res.status).toBe(201)
  })

  it('byte-for-byte round trip: GET .../content returns the exact bytes uploaded, with the correct Content-Type', async () => {
    const bytes = new Uint8Array(300)
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256
    const uploadRes = await uploadFile(H1, { name: 'binary.dat', content: bytes, type: 'application/x-custom' })
    expect(uploadRes.status).toBe(201)
    const created = (await uploadRes.json()) as FileDTO
    expect(created.sizeBytes).toBe(bytes.length)

    const contentRes = await get(`/files/${created.id}/content`, H1)
    expect(contentRes.status).toBe(200)
    expect(contentRes.headers.get('content-type')).toContain('application/x-custom')
    const roundTripped = new Uint8Array(await contentRes.arrayBuffer())
    expect(roundTripped).toEqual(bytes)
  })
})

describe('GET /files/:id', () => {
  it('404 for a nonexistent id', async () => {
    const res = await get('/files/nope', H1)
    expect(res.status).toBe(404)
  })

  it("404 for a file owned by a different user", async () => {
    const uploadRes = await uploadFile(H2, { name: 'theirs.txt' })
    const theirs = (await uploadRes.json()) as FileDTO
    const res = await get(`/files/${theirs.id}`, H1)
    expect(res.status).toBe(404)
  })

  it('200 with the same metadata shape as upload', async () => {
    const uploadRes = await uploadFile(H1, { name: 'meta.txt', content: 'abc', type: 'text/plain' })
    const created = (await uploadRes.json()) as FileDTO
    const res = await get(`/files/${created.id}`, H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as FileDTO
    expect(body).toEqual(created)
  })
})

describe('GET /files/:id/content', () => {
  it('404 for a nonexistent id', async () => {
    const res = await get('/files/nope/content', H1)
    expect(res.status).toBe(404)
  })

  it("404 for a file owned by a different user", async () => {
    const uploadRes = await uploadFile(H2, { name: 'theirs.txt' })
    const theirs = (await uploadRes.json()) as FileDTO
    const res = await get(`/files/${theirs.id}/content`, H1)
    expect(res.status).toBe(404)
  })
})

describe('PATCH /files/:id', () => {
  it('404 for a nonexistent id', async () => {
    const res = await patch('/files/nope', { name: 'x' }, H1)
    expect(res.status).toBe(404)
  })

  it("404 for a file owned by a different user", async () => {
    const uploadRes = await uploadFile(H2, { name: 'theirs.txt' })
    const theirs = (await uploadRes.json()) as FileDTO
    const res = await patch(`/files/${theirs.id}`, { name: 'x' }, H1)
    expect(res.status).toBe(404)
  })

  it('404 when the target folderId does not exist', async () => {
    const uploadRes = await uploadFile(H1, { name: 'f.txt' })
    const f = (await uploadRes.json()) as FileDTO
    const res = await patch(`/files/${f.id}`, { folderId: 'nonexistent' }, H1)
    expect(res.status).toBe(404)
  })

  it("404 when the target folderId belongs to a different user", async () => {
    const uploadRes = await uploadFile(H1, { name: 'f.txt' })
    const f = (await uploadRes.json()) as FileDTO
    const theirsFolder = await createFolder('Theirs', null, H2)
    const res = await patch(`/files/${f.id}`, { folderId: theirsFolder.id }, H1)
    expect(res.status).toBe(404)
  })

  it('409 on a name collision at the resulting location', async () => {
    await uploadFile(H1, { name: 'taken.txt' })
    const uploadRes = await uploadFile(H1, { name: 'movable.txt' })
    const f = (await uploadRes.json()) as FileDTO
    const res = await patch(`/files/${f.id}`, { name: 'taken.txt' }, H1)
    expect(res.status).toBe(409)
  })

  it('409 on a name collision with a folder at the resulting location', async () => {
    await createFolder('taken', null, H1)
    const uploadRes = await uploadFile(H1, { name: 'movable.txt' })
    const f = (await uploadRes.json()) as FileDTO
    const res = await patch(`/files/${f.id}`, { name: 'taken' }, H1)
    expect(res.status).toBe(409)
  })

  it('200 rename updates metadata', async () => {
    const uploadRes = await uploadFile(H1, { name: 'old.txt' })
    const f = (await uploadRes.json()) as FileDTO
    const res = await patch(`/files/${f.id}`, { name: 'new.txt' }, H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as FileDTO
    expect(body.name).toBe('new.txt')
  })

  it('200 move updates folderId', async () => {
    const dest = await createFolder('Dest', null, H1)
    const uploadRes = await uploadFile(H1, { name: 'f.txt' })
    const f = (await uploadRes.json()) as FileDTO
    const res = await patch(`/files/${f.id}`, { folderId: dest.id }, H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as FileDTO
    expect(body.folderId).toBe(dest.id)
  })

  it('renaming and moving a file never changes its byte content', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 250, 251, 252])
    const dest = await createFolder('Dest', null, H1)
    const uploadRes = await uploadFile(H1, { name: 'orig.dat', content: bytes, type: 'application/octet-stream' })
    const f = (await uploadRes.json()) as FileDTO

    const before = new Uint8Array(await (await get(`/files/${f.id}/content`, H1)).arrayBuffer())
    expect(before).toEqual(bytes)

    const renameRes = await patch(`/files/${f.id}`, { name: 'renamed.dat', folderId: dest.id }, H1)
    expect(renameRes.status).toBe(200)

    const after = new Uint8Array(await (await get(`/files/${f.id}/content`, H1)).arrayBuffer())
    expect(after).toEqual(bytes)
  })
})

describe('DELETE /files/:id', () => {
  it('404 for a nonexistent id', async () => {
    const res = await del('/files/nope', H1)
    expect(res.status).toBe(404)
  })

  it("404 for a file owned by a different user", async () => {
    const uploadRes = await uploadFile(H2, { name: 'theirs.txt' })
    const theirs = (await uploadRes.json()) as FileDTO
    const res = await del(`/files/${theirs.id}`, H1)
    expect(res.status).toBe(404)
  })

  it('200 { ok: true }, and the file 404s afterward on both metadata and content', async () => {
    const uploadRes = await uploadFile(H1, { name: 'bye.txt' })
    const f = (await uploadRes.json()) as FileDTO

    const delRes = await del(`/files/${f.id}`, H1)
    expect(delRes.status).toBe(200)
    expect(await delRes.json()).toEqual({ ok: true })

    expect((await get(`/files/${f.id}`, H1)).status).toBe(404)
    expect((await get(`/files/${f.id}/content`, H1)).status).toBe(404)
  })
})
