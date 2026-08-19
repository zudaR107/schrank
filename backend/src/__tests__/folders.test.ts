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

interface FolderDTO {
  id: string
  name: string
  parentId: string | null
  createdAt: string
}

interface FolderView {
  folder: FolderDTO | null
  ancestors: FolderDTO[]
  folders: FolderDTO[]
  files: unknown[]
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

async function uploadFile(
  headers: Record<string, string>,
  opts: { name: string; content?: string | Uint8Array; type?: string; folderId?: string | null },
) {
  const form = new FormData()
  const content = opts.content ?? 'hello world'
  const blobOpts = opts.type ? { type: opts.type } : undefined
  const blob = new Blob([content as BlobPart], blobOpts)
  const file = new File([blob], opts.name, blobOpts)
  form.append('file', file)
  if (opts.folderId !== undefined) form.append('folderId', opts.folderId ?? '')
  return app.request('/files', { method: 'POST', headers, body: form })
}

describe('GET /folders/root', () => {
  it('401 without auth', async () => {
    const res = await app.request('/folders/root')
    expect(res.status).toBe(401)
  })

  it('401 with a bad token', async () => {
    const res = await get('/folders/root', { Authorization: 'Bearer nope' })
    expect(res.status).toBe(401)
  })

  it('200 empty shape for a caller with nothing yet', async () => {
    const res = await get('/folders/root', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as FolderView
    expect(body).toEqual({ folder: null, ancestors: [], folders: [], files: [] })
  })

  it('only returns the caller own top-level items, never another users', async () => {
    await createFolder('Mine', null, H1)
    await createFolder('Theirs', null, H2)

    const res = await get('/folders/root', H1)
    const body = (await res.json()) as FolderView
    expect(body.folders).toHaveLength(1)
    expect(body.folders[0]?.name).toBe('Mine')
  })

  it('does not include nested (non-top-level) folders', async () => {
    const top = await createFolder('Top', null, H1)
    await createFolder('Nested', top.id, H1)

    const res = await get('/folders/root', H1)
    const body = (await res.json()) as FolderView
    expect(body.folders.map((f) => f.name)).toEqual(['Top'])
  })
})

describe('GET /folders/:id', () => {
  it('404 for a nonexistent id', async () => {
    const res = await get('/folders/does-not-exist', H1)
    expect(res.status).toBe(404)
  })

  it('404 for a folder owned by a different user (no info leak)', async () => {
    const theirs = await createFolder('Theirs', null, H2)
    const res = await get(`/folders/${theirs.id}`, H1)
    expect(res.status).toBe(404)
  })

  it('200 with folder, ancestors (root-to-parent order), and direct children only', async () => {
    const a = await createFolder('A', null, H1)
    const b = await createFolder('B', a.id, H1)
    const c = await createFolder('C', b.id, H1)
    const grandchild = await createFolder('GC', c.id, H1)

    const res = await get(`/folders/${c.id}`, H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as FolderView
    expect(body.folder?.id).toBe(c.id)
    expect(body.folder?.name).toBe('C')
    expect(body.ancestors.map((f) => f.id)).toEqual([a.id, b.id])
    expect(body.folders.map((f) => f.id)).toEqual([grandchild.id])
    expect(body.files).toEqual([])
  })

  it('empty ancestors for a top-level folder', async () => {
    const top = await createFolder('Top', null, H1)
    const res = await get(`/folders/${top.id}`, H1)
    const body = (await res.json()) as FolderView
    expect(body.ancestors).toEqual([])
  })

  it("does not leak another user's folder even with an identical id-shaped path", async () => {
    const mine = await createFolder('Mine', null, H1)
    const res = await get(`/folders/${mine.id}`, H2)
    expect(res.status).toBe(404)
  })
})

describe('POST /folders', () => {
  it('401 without auth', async () => {
    const res = await app.request('/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X' }),
    })
    expect(res.status).toBe(401)
  })

  it('201 creates at root when parentId omitted', async () => {
    const res = await post('/folders', { name: 'Root Folder' }, H1)
    expect(res.status).toBe(201)
    const body = (await res.json()) as FolderDTO
    expect(body.name).toBe('Root Folder')
    expect(body.parentId).toBeNull()
    expect(typeof body.id).toBe('string')
  })

  it('201 creates nested under a real parent', async () => {
    const parent = await createFolder('Parent', null, H1)
    const res = await post('/folders', { name: 'Child', parentId: parent.id }, H1)
    expect(res.status).toBe(201)
    const body = (await res.json()) as FolderDTO
    expect(body.parentId).toBe(parent.id)
  })

  it('404 when parentId does not exist', async () => {
    const res = await post('/folders', { name: 'X', parentId: 'nonexistent' }, H1)
    expect(res.status).toBe(404)
  })

  it("404 when parentId belongs to a different user", async () => {
    const theirs = await createFolder('Theirs', null, H2)
    const res = await post('/folders', { name: 'X', parentId: theirs.id }, H1)
    expect(res.status).toBe(404)
  })

  it('409 when the name collides with an existing folder in the same parent', async () => {
    await createFolder('Dup', null, H1)
    const res = await post('/folders', { name: 'Dup' }, H1)
    expect(res.status).toBe(409)
  })

  it('409 when the name collides with an existing FILE in the same parent (shared namespace)', async () => {
    await uploadFile(H1, { name: 'Shared' })
    const res = await post('/folders', { name: 'Shared' }, H1)
    expect(res.status).toBe(409)
  })

  it('does not 409 across different users with the same name', async () => {
    await createFolder('SameName', null, H1)
    const res = await post('/folders', { name: 'SameName' }, H2)
    expect(res.status).toBe(201)
  })

  it('400 for an empty name', async () => {
    const res = await post('/folders', { name: '' }, H1)
    expect(res.status).toBe(400)
  })

  it('400 for a whitespace-only name', async () => {
    const res = await post('/folders', { name: '   ' }, H1)
    expect(res.status).toBe(400)
  })
})

describe('PATCH /folders/:id', () => {
  it('404 for a nonexistent folder', async () => {
    const res = await patch('/folders/nope', { name: 'X' }, H1)
    expect(res.status).toBe(404)
  })

  it("404 for a folder owned by a different user", async () => {
    const theirs = await createFolder('Theirs', null, H2)
    const res = await patch(`/folders/${theirs.id}`, { name: 'X' }, H1)
    expect(res.status).toBe(404)
  })

  it('404 when the new parentId does not exist', async () => {
    const f = await createFolder('F', null, H1)
    const res = await patch(`/folders/${f.id}`, { parentId: 'nonexistent' }, H1)
    expect(res.status).toBe(404)
  })

  it("404 when the new parentId belongs to a different user", async () => {
    const f = await createFolder('F', null, H1)
    const theirs = await createFolder('Theirs', null, H2)
    const res = await patch(`/folders/${f.id}`, { parentId: theirs.id }, H1)
    expect(res.status).toBe(404)
  })

  it('200 rename only', async () => {
    const f = await createFolder('Old Name', null, H1)
    const res = await patch(`/folders/${f.id}`, { name: 'New Name' }, H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as FolderDTO
    expect(body.name).toBe('New Name')
    expect(body.parentId).toBeNull()
  })

  it('200 move only (parent changes, name unchanged)', async () => {
    const dest = await createFolder('Dest', null, H1)
    const f = await createFolder('Movable', null, H1)
    const res = await patch(`/folders/${f.id}`, { parentId: dest.id }, H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as FolderDTO
    expect(body.name).toBe('Movable')
    expect(body.parentId).toBe(dest.id)
  })

  it('200 harmless no-op when both fields are omitted', async () => {
    const f = await createFolder('Untouched', null, H1)
    const res = await patch(`/folders/${f.id}`, {}, H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as FolderDTO
    expect(body.name).toBe('Untouched')
    expect(body.parentId).toBeNull()
  })

  it('200 no-op when both fields equal current values', async () => {
    const parent = await createFolder('Parent', null, H1)
    const f = await createFolder('Child', parent.id, H1)
    const res = await patch(`/folders/${f.id}`, { name: 'Child', parentId: parent.id }, H1)
    expect(res.status).toBe(200)
  })

  it('400 self-move cycle (folder becomes its own parent)', async () => {
    const f = await createFolder('Self', null, H1)
    const res = await patch(`/folders/${f.id}`, { parentId: f.id }, H1)
    expect(res.status).toBe(400)
  })

  it('400 deep-descendant-move cycle (folder becomes a child of its own grandchild)', async () => {
    const a = await createFolder('A', null, H1)
    const b = await createFolder('B', a.id, H1)
    const c = await createFolder('C', b.id, H1)
    const res = await patch(`/folders/${a.id}`, { parentId: c.id }, H1)
    expect(res.status).toBe(400)
  })

  it('400 cycle when a folder is moved to become a child of its own immediate child', async () => {
    const a = await createFolder('A', null, H1)
    const b = await createFolder('B', a.id, H1)
    const res = await patch(`/folders/${a.id}`, { parentId: b.id }, H1)
    expect(res.status).toBe(400)
  })

  it('200 moving to its own current parent is a harmless no-op reparent', async () => {
    const a = await createFolder('A', null, H1)
    const b = await createFolder('B', a.id, H1)
    const res = await patch(`/folders/${b.id}`, { parentId: a.id }, H1)
    expect(res.status).toBe(200)
  })

  it('200 moving to an unrelated folder succeeds', async () => {
    const a = await createFolder('A', null, H1)
    const b = await createFolder('B', a.id, H1)
    const unrelated = await createFolder('Unrelated', null, H1)
    const res = await patch(`/folders/${b.id}`, { parentId: unrelated.id }, H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as FolderDTO
    expect(body.parentId).toBe(unrelated.id)
  })

  it('200 moving a descendant up to become a child of its own grandparent (not a cycle)', async () => {
    const a = await createFolder('A', null, H1)
    const b = await createFolder('B', a.id, H1)
    const c = await createFolder('C', b.id, H1)
    const res = await patch(`/folders/${c.id}`, { parentId: a.id }, H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as FolderDTO
    expect(body.parentId).toBe(a.id)
  })

  it('409 when the rename collides with a sibling folder', async () => {
    await createFolder('Taken', null, H1)
    const f = await createFolder('Movable', null, H1)
    const res = await patch(`/folders/${f.id}`, { name: 'Taken' }, H1)
    expect(res.status).toBe(409)
  })

  it('409 when the rename collides with a sibling FILE', async () => {
    await uploadFile(H1, { name: 'Taken' })
    const f = await createFolder('Movable', null, H1)
    const res = await patch(`/folders/${f.id}`, { name: 'Taken' }, H1)
    expect(res.status).toBe(409)
  })

  it('409 when a move lands on an existing name in the destination', async () => {
    const dest = await createFolder('Dest', null, H1)
    await createFolder('Occupied', dest.id, H1)
    const f = await createFolder('Movable', null, H1)
    const res = await patch(`/folders/${f.id}`, { name: 'Occupied', parentId: dest.id }, H1)
    expect(res.status).toBe(409)
  })
})

describe('DELETE /folders/:id', () => {
  it('404 for a nonexistent folder', async () => {
    const res = await del('/folders/nope', H1)
    expect(res.status).toBe(404)
  })

  it("404 for another user's folder", async () => {
    const theirs = await createFolder('Theirs', null, H2)
    const res = await del(`/folders/${theirs.id}`, H1)
    expect(res.status).toBe(404)
  })

  it('200 { ok: true } on success', async () => {
    const f = await createFolder('Bye', null, H1)
    const res = await del(`/folders/${f.id}`, H1)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('recursively deletes descendant folders and files at every depth, including their bytes', async () => {
    const root = await createFolder('Root', null, H1)
    const child = await createFolder('Child', root.id, H1)
    const grandchild = await createFolder('Grandchild', child.id, H1)
    const uploadRes = await uploadFile(H1, {
      name: 'deep.txt',
      content: 'deep content',
      folderId: grandchild.id,
    })
    expect(uploadRes.status).toBe(201)
    const deepFile = (await uploadRes.json()) as { id: string }

    const shallowUploadRes = await uploadFile(H1, {
      name: 'shallow.txt',
      content: 'shallow content',
      folderId: child.id,
    })
    const shallowFile = (await shallowUploadRes.json()) as { id: string }

    const delRes = await del(`/folders/${root.id}`, H1)
    expect(delRes.status).toBe(200)

    expect((await get(`/folders/${root.id}`, H1)).status).toBe(404)
    expect((await get(`/folders/${child.id}`, H1)).status).toBe(404)
    expect((await get(`/folders/${grandchild.id}`, H1)).status).toBe(404)
    expect((await get(`/files/${deepFile.id}`, H1)).status).toBe(404)
    expect((await get(`/files/${shallowFile.id}`, H1)).status).toBe(404)
    // The bytes themselves must actually be gone from storage too.
    expect((await get(`/files/${deepFile.id}/content`, H1)).status).toBe(404)
    expect((await get(`/files/${shallowFile.id}/content`, H1)).status).toBe(404)
  })

  it("never affects a different user's identically-structured folders/files", async () => {
    const mine = await createFolder('Shared Name', null, H1)
    const mineChild = await createFolder('Child', mine.id, H1)
    await uploadFile(H1, { name: 'f.txt', folderId: mineChild.id })

    const theirs = await createFolder('Shared Name', null, H2)
    const theirsChild = await createFolder('Child', theirs.id, H2)
    const theirsUpload = await uploadFile(H2, { name: 'f.txt', folderId: theirsChild.id })
    const theirsFile = (await theirsUpload.json()) as { id: string }

    const delRes = await del(`/folders/${mine.id}`, H1)
    expect(delRes.status).toBe(200)

    expect((await get(`/folders/${theirs.id}`, H2)).status).toBe(200)
    expect((await get(`/folders/${theirsChild.id}`, H2)).status).toBe(200)
    expect((await get(`/files/${theirsFile.id}`, H2)).status).toBe(200)
    const contentRes = await get(`/files/${theirsFile.id}/content`, H2)
    expect(contentRes.status).toBe(200)
  })
})
