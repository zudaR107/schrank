import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../db/index.js', async () => await import('./helpers/db.js'))
vi.mock('../middleware/auth.js', async () => await import('./helpers/auth-mock.js'))

import { sqlite, cleanDb } from './helpers/db.js'
import { createTestApp } from './helpers/setup.js'

const app = createTestApp()

const H1 = { Authorization: 'Bearer test-token' }
const H2 = { Authorization: 'Bearer user2-token' }
const DELEGATION_1 = { Authorization: 'Bearer schrank-export-delegation-token' }
const DELEGATION_2 = { Authorization: 'Bearer schrank-export-user2-delegation-token' }

function wipeDb() {
  cleanDb()
  sqlite.exec('DELETE FROM files')
  sqlite.exec('DELETE FROM folders')
}

beforeEach(() => wipeDb())

interface ExportDTO {
  version: string
  service: string
  exportedAt: string
  data: {
    folders: Record<string, unknown>[]
    files: Record<string, unknown>[]
  }
}

const get = (path: string, headers?: Record<string, string>) =>
  headers ? app.request(path, { headers }) : app.request(path)

const post = (path: string, body: unknown, headers: Record<string, string>) =>
  app.request(path, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

async function createFolder(name: string, headers: Record<string, string>) {
  const res = await post('/folders', { name }, headers)
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string }
}

function uploadFile(headers: Record<string, string>, name: string, folderId?: string) {
  const form = new FormData()
  form.append('file', new File(['content'], name, { type: 'text/plain' }))
  if (folderId !== undefined) form.append('folderId', folderId)
  return app.request('/files', { method: 'POST', headers, body: form })
}

describe('GET /exports/me', () => {
  it('401 without any credential', async () => {
    const res = await app.request('/exports/me')
    expect(res.status).toBe(401)
  })

  it('401 with an invalid token', async () => {
    const res = await get('/exports/me', { Authorization: 'Bearer garbage' })
    expect(res.status).toBe(401)
  })

  it('200 with a normal bearer token, correct envelope shape', async () => {
    const res = await get('/exports/me', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ExportDTO
    expect(body.version).toBe('1')
    expect(body.service).toBe('schrank')
    expect(typeof body.exportedAt).toBe('string')
    expect(Number.isNaN(Date.parse(body.exportedAt))).toBe(false)
    expect(Array.isArray(body.data.folders)).toBe(true)
    expect(Array.isArray(body.data.files)).toBe(true)
  })

  it('200 with the delegation token for user-1, returning the same data a normal token would', async () => {
    const folder = await createFolder('Docs', H1)
    await uploadFile(H1, 'a.txt', folder.id)

    const res = await get('/exports/me', DELEGATION_1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ExportDTO
    expect(body.data.folders).toHaveLength(1)
    expect(body.data.files).toHaveLength(1)
  })

  it('200 with the delegation token for user-2, scoped to user-2 only', async () => {
    await createFolder('User1Folder', H1)
    const theirsFolder = await createFolder('User2Folder', H2)
    await uploadFile(H2, 'b.txt', theirsFolder.id)

    const res = await get('/exports/me', DELEGATION_2)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ExportDTO
    expect(body.data.folders).toHaveLength(1)
    expect(body.data.folders[0]?.['name']).toBe('User2Folder')
    expect(body.data.files).toHaveLength(1)
  })

  it('cross-user isolation: export never includes another user data', async () => {
    await createFolder('Mine', H1)
    await uploadFile(H1, 'mine.txt')
    await createFolder('Theirs', H2)
    await uploadFile(H2, 'theirs.txt')

    const res = await get('/exports/me', H1)
    const body = (await res.json()) as ExportDTO
    const folderNames = body.data.folders.map((f) => f['name'])
    const fileNames = body.data.files.map((f) => f['name'])
    expect(folderNames).toEqual(['Mine'])
    expect(fileNames).toEqual(['mine.txt'])
  })

  it('folder and file entries never include a storagePath field', async () => {
    const folder = await createFolder('Docs', H1)
    await uploadFile(H1, 'a.txt', folder.id)

    const res = await get('/exports/me', H1)
    const body = (await res.json()) as ExportDTO
    for (const f of body.data.folders) {
      expect('storagePath' in f).toBe(false)
    }
    for (const f of body.data.files) {
      expect('storagePath' in f).toBe(false)
    }
  })
})
