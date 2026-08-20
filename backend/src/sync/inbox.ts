import { Hono } from 'hono'
import { verifyNotificationRequest, notificationEventEnvelopeSchema } from '@zudar107/schloss-server-kit'
import { createHash } from 'node:crypto'
import { createId } from '@paralleldrive/cuid2'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/index.js'
import { users, files, zettelMirrors, inboxEvents } from '../db/schema.js'
import { nameTaken } from '../lib/folders.js'
import { storagePathFor, writeFileBytes, deleteFileBytes } from '../lib/storage.js'
import { ensureZettelFolder } from '../lib/wellKnownFolder.js'

const SOURCE = 'zettel'
const MAX_EVENT_BYTES = 2 * 1024 * 1024
const strictEnvelopeSchema = notificationEventEnvelopeSchema.strict()

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const mirroredPayloadSchema = z.object({
  noteId: z.string().min(1),
  ownerUserId: z.string().min(1),
  ownerEmail: z.string().min(1),
  ownerName: z.string().min(1),
  title: z.string(),
  content: z.string(),
})

const unmirroredPayloadSchema = z.object({
  noteId: z.string().min(1),
  ownerUserId: z.string().min(1),
})

function ensureUser(tx: Tx, id: string, email: string, name: string): void {
  const existing = tx.select({ id: users.id }).from(users).where(eq(users.id, id)).get()
  if (!existing) {
    tx.insert(users).values({ id, email, name, createdAt: new Date() }).run()
  }
}

// A note's title becomes a .md filename - sanitized to strip characters
// that can't live in a filesystem name, trimmed, and never empty (mirrors
// the note's own '' title default).
function filenameFor(title: string): string {
  const base = title.trim().replaceAll(/[/\\:*?"<>|]/g, ' ').replaceAll(/\s+/g, ' ').trim()
  return `${base || 'Без названия'}.md`
}

// Both apply* functions run inside the caller's already-open transaction
// (see the route handler below), alongside the inbox dedupe insert -
// writeFileBytes/deleteFileBytes are synchronous fs calls, so calling
// them from inside a better-sqlite3 transaction callback is safe; if
// anything after them throws, the SQL work rolls back and any bytes
// already written become a harmless orphan .tmp-then-renamed file with
// no DB row pointing at it.
function applyMirrored(tx: Tx, payload: z.infer<typeof mirroredPayloadSchema>): void {
  ensureUser(tx, payload.ownerUserId, payload.ownerEmail, payload.ownerName)
  const folder = ensureZettelFolder(tx, payload.ownerUserId)
  const bytes = new TextEncoder().encode(payload.content)
  const existingMirror = tx.select().from(zettelMirrors)
    .where(eq(zettelMirrors.noteId, payload.noteId)).get()

  let name = filenameFor(payload.title)

  if (existingMirror) {
    const existingFile = tx.select().from(files).where(eq(files.id, existingMirror.fileId)).get()
    if (!existingFile) return // mirror row survived a file that's since gone missing - nothing to update
    if (name !== existingFile.name && nameTaken(tx, payload.ownerUserId, folder.id, name)) {
      name = `${name.slice(0, -3)} (${existingMirror.fileId.slice(0, 6)}).md`
    }
    tx.update(files).set({ name, sizeBytes: bytes.byteLength, updatedAt: new Date() })
      .where(eq(files.id, existingMirror.fileId)).run()
    writeFileBytes(storagePathFor(payload.ownerUserId, existingMirror.fileId), bytes)
    return
  }

  if (nameTaken(tx, payload.ownerUserId, folder.id, name)) {
    name = `${name.slice(0, -3)} (${payload.noteId.slice(0, 6)}).md`
  }
  const fileId = createId()
  const now = new Date()
  tx.insert(files).values({
    id: fileId, ownerUserId: payload.ownerUserId, folderId: folder.id, name,
    mimeType: 'text/markdown', sizeBytes: bytes.byteLength,
    storagePath: storagePathFor(payload.ownerUserId, fileId), createdAt: now, updatedAt: now,
  }).run()
  tx.insert(zettelMirrors).values({
    fileId, noteId: payload.noteId, ownerUserId: payload.ownerUserId, createdAt: now,
  }).run()
  writeFileBytes(storagePathFor(payload.ownerUserId, fileId), bytes)
}

function applyUnmirrored(tx: Tx, payload: z.infer<typeof unmirroredPayloadSchema>): void {
  const mirror = tx.select().from(zettelMirrors).where(eq(zettelMirrors.noteId, payload.noteId)).get()
  if (!mirror) return
  const file = tx.select().from(files).where(eq(files.id, mirror.fileId)).get()
  tx.delete(files).where(eq(files.id, mirror.fileId)).run() // cascades the zettelMirrors row too
  if (file) deleteFileBytes(file.storagePath)
}

const router = new Hono()

router.post('/events', async (c) => {
  const contentLength = Number(c.req.header('Content-Length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_EVENT_BYTES) {
    return c.json({ error: 'Request body too large' }, 413)
  }
  const rawBytes = new Uint8Array(await c.req.raw.arrayBuffer())
  if (rawBytes.byteLength > MAX_EVENT_BYTES) return c.json({ error: 'Request body too large' }, 413)
  const rawBody = new TextDecoder().decode(rawBytes)

  const source = c.req.header('X-Hof-Service') ?? ''
  const keyIdHeader = c.req.header('X-Hof-Key-Id')
  const timestampHeader = c.req.header('X-Hof-Timestamp')
  const signatureHeader = c.req.header('X-Hof-Signature')
  if (!source || !keyIdHeader || !timestampHeader || !signatureHeader) {
    return c.json({ error: 'Missing signature' }, 401)
  }
  if (source !== SOURCE) return c.json({ error: 'Producer is not configured' }, 403)

  const keyId = process.env['ZETTEL_TO_SCHRANK_HMAC_KEY_ID']
  const secret = process.env['ZETTEL_TO_SCHRANK_HMAC_SECRET']
  if (!keyId || !secret) return c.json({ error: 'Producer is not configured' }, 403)

  const timestamp = Number(timestampHeader)
  const requestUrl = new URL(c.req.url)
  const validSignature = verifyNotificationRequest({
    secret, keyId: keyIdHeader, source, timestamp,
    method: c.req.method, path: `${requestUrl.pathname}${requestUrl.search}`,
    rawBody: rawBytes, signature: signatureHeader,
    expectedKeyId: keyId, expectedSource: SOURCE, maxSkewSeconds: 300,
  })
  if (!validSignature) return c.json({ error: 'Invalid signature' }, 401)

  let json: unknown
  try {
    json = JSON.parse(rawBody)
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }
  const parsed = strictEnvelopeSchema.safeParse(json)
  if (!parsed.success || parsed.data.source !== source) {
    return c.json({ error: 'Invalid event envelope' }, 400)
  }
  const envelope = parsed.data

  let payload: z.infer<typeof mirroredPayloadSchema> | z.infer<typeof unmirroredPayloadSchema>
  if (envelope.type === 'zettel.note.mirrored.v1') {
    const result = mirroredPayloadSchema.safeParse(envelope.payload)
    if (!result.success) return c.json({ error: 'Invalid event envelope' }, 400)
    payload = result.data
  } else if (envelope.type === 'zettel.note.unmirrored.v1') {
    const result = unmirroredPayloadSchema.safeParse(envelope.payload)
    if (!result.success) return c.json({ error: 'Invalid event envelope' }, 400)
    payload = result.data
  } else {
    return c.json({ error: 'Invalid event envelope' }, 400)
  }

  const payloadHash = createHash('sha256').update(rawBytes).digest('hex')
  const outcome = db.transaction((tx) => {
    const existing = tx.select().from(inboxEvents)
      .where(and(eq(inboxEvents.source, source), eq(inboxEvents.eventId, envelope.id))).get()
    if (existing) return existing.payloadHash === payloadHash ? 'duplicate' as const : 'conflict' as const

    if (envelope.type === 'zettel.note.mirrored.v1') {
      applyMirrored(tx, payload as z.infer<typeof mirroredPayloadSchema>)
    } else {
      applyUnmirrored(tx, payload as z.infer<typeof unmirroredPayloadSchema>)
    }
    tx.insert(inboxEvents).values({ source, eventId: envelope.id, payloadHash, receivedAt: new Date() }).run()
    return 'accepted' as const
  })

  if (outcome === 'conflict') return c.json({ error: 'Event identity conflict' }, 409)
  if (outcome === 'duplicate') return c.json({ status: 'duplicate' })
  return c.json({ status: 'accepted' }, 202)
})

export { router as syncInboxRouter }
