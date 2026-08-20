import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, isNull } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { db } from '../../db/index.js'
import { folders, files } from '../../db/schema.js'
import { requireAuth } from '../../middleware/auth.js'
import { getOwnedFolder, ancestorsOf, isSelfOrAncestor, itemCountOf, nameTaken } from '../../lib/folders.js'
import { folderJson, fileJson } from '../../lib/serialize.js'
import { deleteFileBytes } from '../../lib/storage.js'

const router = new Hono()
router.use('*', requireAuth)

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  parentId: z.string().nullable().default(null),
})

const updateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  parentId: z.string().nullable().optional(),
})

function contents(ownerUserId: string, folderId: string | null) {
  const parentCondition = folderId === null ? isNull(folders.parentId) : eq(folders.parentId, folderId)
  const fileParentCondition = folderId === null ? isNull(files.folderId) : eq(files.folderId, folderId)
  const childFolders = db.select().from(folders).where(and(eq(folders.ownerUserId, ownerUserId), parentCondition)).all()
  const childFiles = db.select().from(files).where(and(eq(files.ownerUserId, ownerUserId), fileParentCondition)).all()
  return {
    folders: childFolders.map((f) => ({ ...folderJson(f), itemCount: itemCountOf(db, ownerUserId, f.id) })),
    files: childFiles.map(fileJson),
  }
}

router.get('/root', (c) => {
  const user = c.get('user')
  return c.json({ folder: null, ancestors: [], ...contents(user.id, null) })
})

router.get('/:id', (c) => {
  const user = c.get('user')
  const { id } = c.req.param()
  const folder = getOwnedFolder(db, user.id, id)
  if (!folder) return c.json({ error: 'Not found' }, 404)
  return c.json({
    folder: folderJson(folder),
    ancestors: ancestorsOf(db, user.id, folder.parentId).map(folderJson),
    ...contents(user.id, id),
  })
})

router.post('/', zValidator('json', createSchema), (c) => {
  const user = c.get('user')
  const { name, parentId } = c.req.valid('json')

  if (parentId !== null && !getOwnedFolder(db, user.id, parentId)) {
    return c.json({ error: 'Parent folder not found' }, 404)
  }
  if (nameTaken(db, user.id, parentId, name)) {
    return c.json({ error: 'A folder or file with that name already exists here' }, 409)
  }

  const folder = { id: createId(), ownerUserId: user.id, parentId, name, createdAt: new Date() }
  db.insert(folders).values(folder).run()
  return c.json(folderJson(folder), 201)
})

router.patch('/:id', zValidator('json', updateSchema), (c) => {
  const user = c.get('user')
  const { id } = c.req.param()
  const { name, parentId } = c.req.valid('json')

  const result = db.transaction((tx) => {
    const existing = getOwnedFolder(tx, user.id, id)
    if (!existing) return 'not-found' as const

    const nextParentId = parentId === undefined ? existing.parentId : parentId
    const nextName = name ?? existing.name

    if (nextParentId !== existing.parentId) {
      if (nextParentId !== null) {
        const target = getOwnedFolder(tx, user.id, nextParentId)
        if (!target) return 'parent-not-found' as const
      }
      if (nextParentId !== null && isSelfOrAncestor(tx, user.id, id, nextParentId)) return 'cycle' as const
    }

    if ((nextName !== existing.name || nextParentId !== existing.parentId)
      && nameTaken(tx, user.id, nextParentId, nextName, id)) {
      return 'name-taken' as const
    }

    tx.update(folders).set({ name: nextName, parentId: nextParentId }).where(eq(folders.id, id)).run()
    return folderJson({ ...existing, name: nextName, parentId: nextParentId })
  })

  if (result === 'not-found') return c.json({ error: 'Not found' }, 404)
  if (result === 'parent-not-found') return c.json({ error: 'Parent folder not found' }, 404)
  if (result === 'cycle') return c.json({ error: 'Cannot move a folder into itself or one of its own subfolders' }, 400)
  if (result === 'name-taken') return c.json({ error: 'A folder or file with that name already exists here' }, 409)
  return c.json(result)
})

// Recursive delete: the folders.parentId and files.folderId FKs both
// cascade at the SQLite level (foreign_keys = ON, db/index.ts), so
// deleting the top folder row removes every descendant folder/file row
// automatically. That only cleans up the database though - the actual
// bytes on disk need collecting and removing separately, and must
// happen BEFORE the transaction commits the cascade (afterward, the
// rows naming those paths are gone).
router.delete('/:id', (c) => {
  const user = c.get('user')
  const { id } = c.req.param()

  const storagePaths = db.transaction((tx) => {
    const existing = getOwnedFolder(tx, user.id, id)
    if (!existing) return 'not-found' as const

    // Every descendant folder id, including this one, found by repeated
    // LIKE-free BFS over parentId (personal-scale folder trees, no need
    // for a recursive CTE).
    const descendantIds = [id]
    for (let i = 0; i < descendantIds.length; i++) {
      const children = tx.select({ id: folders.id }).from(folders)
        .where(and(eq(folders.ownerUserId, user.id), eq(folders.parentId, descendantIds[i]!)))
        .all()
      for (const child of children) descendantIds.push(child.id)
    }

    const affectedFiles = descendantIds.flatMap((folderId) =>
      tx.select({ storagePath: files.storagePath }).from(files)
        .where(and(eq(files.ownerUserId, user.id), eq(files.folderId, folderId)))
        .all(),
    )

    tx.delete(folders).where(eq(folders.id, id)).run()
    return affectedFiles.map((f) => f.storagePath)
  })

  if (storagePaths === 'not-found') return c.json({ error: 'Not found' }, 404)
  for (const path of storagePaths) deleteFileBytes(path)
  return c.json({ ok: true })
})

export { router as foldersRouter }
