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

interface UsageDTO {
  usedBytes: number
  limitBytes: number
}

interface FileDTO {
  id: string
  sizeBytes: number
}

const get = (path: string, headers?: Record<string, string>) =>
  headers ? app.request(path, { headers }) : app.request(path)

const del = (path: string, headers: Record<string, string>) =>
  app.request(path, { method: 'DELETE', headers })

function uploadFile(headers: Record<string, string>, name: string, content: string) {
  const form = new FormData()
  form.append('file', new File([content], name, { type: 'text/plain' }))
  return app.request('/files', { method: 'POST', headers, body: form })
}

describe('GET /usage', () => {
  it('401 without auth', async () => {
    const res = await app.request('/usage')
    expect(res.status).toBe(401)
  })

  it('401 with a bad token', async () => {
    const res = await get('/usage', { Authorization: 'Bearer bad' })
    expect(res.status).toBe(401)
  })

  it('200 { usedBytes: 0, limitBytes: <positive number> } for a fresh caller', async () => {
    const res = await get('/usage', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as UsageDTO
    expect(body.usedBytes).toBe(0)
    expect(typeof body.limitBytes).toBe('number')
    expect(body.limitBytes).toBeGreaterThan(0)
  })

  it('usedBytes sums only the caller own files', async () => {
    const r1 = await uploadFile(H1, 'a.txt', 'hello') // 5 bytes
    const r2 = await uploadFile(H1, 'b.txt', 'hello world!') // 12 bytes
    expect(r1.status).toBe(201)
    expect(r2.status).toBe(201)

    const res = await get('/usage', H1)
    const body = (await res.json()) as UsageDTO
    expect(body.usedBytes).toBe(5 + 12)
  })

  it("another user's uploads never change the first user's usedBytes", async () => {
    await uploadFile(H1, 'mine.txt', 'abc')
    const before = ((await (await get('/usage', H1)).json()) as UsageDTO).usedBytes

    await uploadFile(H2, 'theirs.txt', 'a much much longer piece of content here')

    const after = ((await (await get('/usage', H1)).json()) as UsageDTO).usedBytes
    expect(after).toBe(before)
  })

  it("another user's deletes never change the first user's usedBytes", async () => {
    await uploadFile(H1, 'mine.txt', 'abc')
    const theirsRes = await uploadFile(H2, 'theirs.txt', 'xyz123')
    const theirs = (await theirsRes.json()) as FileDTO

    const before = ((await (await get('/usage', H1)).json()) as UsageDTO).usedBytes
    await del(`/files/${theirs.id}`, H2)
    const after = ((await (await get('/usage', H1)).json()) as UsageDTO).usedBytes
    expect(after).toBe(before)
  })

  it('deleting one of the caller own files decreases usedBytes by that file size', async () => {
    const r1 = await uploadFile(H1, 'a.txt', 'hello') // 5 bytes
    const f1 = (await r1.json()) as FileDTO
    const r2 = await uploadFile(H1, 'b.txt', 'hello world!') // 12 bytes
    expect(r2.status).toBe(201)

    const before = ((await (await get('/usage', H1)).json()) as UsageDTO).usedBytes
    expect(before).toBe(17)

    const delRes = await del(`/files/${f1.id}`, H1)
    expect(delRes.status).toBe(200)

    const after = ((await (await get('/usage', H1)).json()) as UsageDTO).usedBytes
    expect(after).toBe(12)
  })
})
