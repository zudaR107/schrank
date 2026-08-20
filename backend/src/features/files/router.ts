import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { db } from '../../db/index.js'
import { files, zettelMirrors } from '../../db/schema.js'
import { requireAuth } from '../../middleware/auth.js'
import { getOwnedFolder, nameTaken } from '../../lib/folders.js'
import { fileJson } from '../../lib/serialize.js'
import { storagePathFor, isSafeStoragePath, writeFileBytes, readFileStream, deleteFileBytes } from '../../lib/storage.js'
import { MAX_FILE_BYTES, MAX_BYTES_PER_USER, usedBytes } from '../../lib/quota.js'
import { isZettelFolder } from '../../lib/wellKnownFolder.js'
import { enqueueZettelSyncEvent } from '../../sync/enqueue.js'

const MIRRORABLE_EXTENSION = /\.(md|markdown)$/i

const router = new Hono()
router.use('*', requireAuth)

function getOwnedFile(ownerUserId: string, id: string) {
  return db.select().from(files).where(and(eq(files.id, id), eq(files.ownerUserId, ownerUserId))).get()
}

router.post('/', async (c) => {
  const user = c.get('user')

  let body: Record<string, string | File>
  try {
    body = await c.req.parseBody()
  } catch {
    return c.json({ error: 'Invalid multipart body' }, 400)
  }

  const upload = body['file']
  if (!(upload instanceof File)) return c.json({ error: 'Missing "file" field' }, 400)

  const folderIdRaw = body['folderId']
  const folderId = typeof folderIdRaw === 'string' && folderIdRaw.length > 0 ? folderIdRaw : null
  if (folderId !== null && !getOwnedFolder(db, user.id, folderId)) {
    return c.json({ error: 'Folder not found' }, 404)
  }

  const name = upload.name.trim()
  if (!name) return c.json({ error: 'File must have a name' }, 400)
  if (upload.size > MAX_FILE_BYTES) {
    return c.json({ error: `File exceeds the ${MAX_FILE_BYTES}-byte per-file limit` }, 413)
  }
  if (usedBytes(user.id) + upload.size > MAX_BYTES_PER_USER) {
    return c.json({ error: 'Storage quota exceeded' }, 413)
  }

  // Read the upload body BEFORE the uniqueness check below, not after -
  // `arrayBuffer()` is the only await between the check and the insert,
  // and used to sit *after* the check, leaving a window where two
  // concurrent uploads of the same name could both pass it before either
  // inserted (Node can't preempt a synchronous stretch of code, so once
  // nothing here awaits between the check and the write, the race closes
  // on its own - db.transaction() below is for write atomicity, not this).
  const bytes = new Uint8Array(await upload.arrayBuffer())

  if (nameTaken(db, user.id, folderId, name)) {
    return c.json({ error: 'A folder or file with that name already exists here' }, 409)
  }

  const id = createId()
  const storagePath = storagePathFor(user.id, id)
  const now = new Date()
  const record = {
    id, ownerUserId: user.id, folderId, name,
    mimeType: upload.type || 'application/octet-stream',
    sizeBytes: upload.size, storagePath, createdAt: now, updatedAt: now,
  }

  db.transaction((tx) => {
    tx.insert(files).values(record).run()
    writeFileBytes(storagePath, bytes)

    // Only .md/.markdown uploads landing directly in the owner's
    // well-known "zettel" folder become notes - anything else uploaded
    // there is left alone, matching Schrank staying a fully generic file
    // store with no folder-specific rules baked into the upload path
    // itself (see sync/inbox.ts for the other half of this integration).
    if (isZettelFolder(tx, user.id, folderId) && MIRRORABLE_EXTENSION.test(name)) {
      const noteId = createId()
      tx.insert(zettelMirrors).values({ fileId: id, noteId, ownerUserId: user.id, createdAt: now }).run()
      enqueueZettelSyncEvent(tx, 'schrank.file.zettel_created.v1', user.id, {
        noteId, ownerUserId: user.id, ownerEmail: user.email, ownerName: user.name,
        title: name.replace(MIRRORABLE_EXTENSION, ''), content: new TextDecoder().decode(bytes),
      })
    }
  })

  return c.json(fileJson(record), 201)
})

router.get('/:id', (c) => {
  const user = c.get('user')
  const file = getOwnedFile(user.id, c.req.param('id'))
  if (!file) return c.json({ error: 'Not found' }, 404)
  return c.json(fileJson(file))
})

router.get('/:id/content', (c) => {
  const user = c.get('user')
  const file = getOwnedFile(user.id, c.req.param('id'))
  if (!file) return c.json({ error: 'Not found' }, 404)
  if (!isSafeStoragePath(user.id, file.storagePath)) return c.json({ error: 'Not found' }, 404)

  c.header('Content-Type', file.mimeType)
  c.header('Content-Length', String(file.sizeBytes))
  c.header('Cache-Control', 'private, no-store')
  c.header('X-Content-Type-Options', 'nosniff')
  return c.body(readFileStream(file.storagePath))
})

const updateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  folderId: z.string().nullable().optional(),
})

router.patch('/:id', zValidator('json', updateSchema), (c) => {
  const user = c.get('user')
  const { id } = c.req.param()
  const { name, folderId } = c.req.valid('json')

  const result = db.transaction((tx) => {
    const existing = tx.select().from(files).where(and(eq(files.id, id), eq(files.ownerUserId, user.id))).get()
    if (!existing) return 'not-found' as const

    const nextFolderId = folderId === undefined ? existing.folderId : folderId
    const nextName = name ?? existing.name

    if (nextFolderId !== existing.folderId && nextFolderId !== null && !getOwnedFolder(tx, user.id, nextFolderId)) {
      return 'folder-not-found' as const
    }
    if ((nextName !== existing.name || nextFolderId !== existing.folderId)
      && nameTaken(tx, user.id, nextFolderId, nextName)) {
      return 'name-taken' as const
    }

    const updatedAt = new Date()
    tx.update(files).set({ name: nextName, folderId: nextFolderId, updatedAt }).where(eq(files.id, id)).run()

    // Title-only sync back to Zettel - never content, since Schrank has
    // no file-editing feature at all. A move (folderId change alone)
    // doesn't rename the note, so it's excluded from this check.
    if (nextName !== existing.name) {
      const mirror = tx.select().from(zettelMirrors).where(eq(zettelMirrors.fileId, id)).get()
      if (mirror) {
        enqueueZettelSyncEvent(tx, 'schrank.file.zettel_renamed.v1', user.id, {
          noteId: mirror.noteId, ownerUserId: user.id, title: nextName.replace(MIRRORABLE_EXTENSION, ''),
        })
      }
    }

    return fileJson({ ...existing, name: nextName, folderId: nextFolderId, updatedAt })
  })

  if (result === 'not-found') return c.json({ error: 'Not found' }, 404)
  if (result === 'folder-not-found') return c.json({ error: 'Folder not found' }, 404)
  if (result === 'name-taken') return c.json({ error: 'A folder or file with that name already exists here' }, 409)
  return c.json(result)
})

router.delete('/:id', (c) => {
  const user = c.get('user')
  const { id } = c.req.param()

  const existing = db.transaction((tx) => {
    const file = tx.select().from(files).where(and(eq(files.id, id), eq(files.ownerUserId, user.id))).get()
    if (!file) return null

    const mirror = tx.select().from(zettelMirrors).where(eq(zettelMirrors.fileId, id)).get()
    tx.delete(files).where(eq(files.id, id)).run() // cascades the zettelMirrors row too
    if (mirror) {
      enqueueZettelSyncEvent(tx, 'schrank.file.zettel_deleted.v1', user.id, {
        noteId: mirror.noteId, ownerUserId: user.id,
      })
    }
    return file
  })

  if (!existing) return c.json({ error: 'Not found' }, 404)
  deleteFileBytes(existing.storagePath)
  return c.json({ ok: true })
})

export { router as filesRouter }
