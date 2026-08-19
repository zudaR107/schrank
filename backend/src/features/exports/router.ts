import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { exportEnvelopeSchema, type ExportAuthEnv } from '@zudar107/schloss-server-kit'
import { db } from '../../db/index.js'
import { folders, files, type Folder, type FileRecord } from '../../db/schema.js'
import { requireExportAuth } from '../../middleware/auth.js'

// exportEnvelopeSchema's `data` field is a strict JSON schema (string/
// number/boolean/null/array/record) - a raw Date instance doesn't match
// any of those branches, unlike a plain c.json() response (which
// JSON.stringifies Date via its own toJSON() without zod ever looking
// at the runtime type first), so timestamps need converting to ISO
// strings explicitly before validation, not just at serialization time.
function exportFolder(folder: Folder) {
  return { id: folder.id, name: folder.name, parentId: folder.parentId, createdAt: folder.createdAt.toISOString() }
}

function exportFile(file: FileRecord) {
  return {
    id: file.id, name: file.name, folderId: file.folderId, mimeType: file.mimeType, sizeBytes: file.sizeBytes,
    createdAt: file.createdAt.toISOString(), updatedAt: file.updatedAt.toISOString(),
  }
}

const router = new Hono<ExportAuthEnv>()

// Metadata only - folder tree and file records (name/size/mime/
// timestamps), never the file bytes themselves. A JSON envelope has no
// sane way to carry arbitrary binary content, and every other service's
// own /exports/me is metadata/text, not a bytes dump either.
router.get('/me', requireExportAuth, (c) => {
  c.header('Cache-Control', 'private, no-store')
  c.header('Pragma', 'no-cache')
  c.header('X-Content-Type-Options', 'nosniff')

  const principal = c.get('exportPrincipal')
  const ownerUserId = principal.sub

  const folderRows = db.select().from(folders).where(eq(folders.ownerUserId, ownerUserId)).all()
  const fileRows = db.select().from(files).where(eq(files.ownerUserId, ownerUserId)).all()

  return c.json(exportEnvelopeSchema.parse({
    version: '1',
    service: 'schrank',
    exportedAt: new Date().toISOString(),
    data: {
      folders: folderRows.map(exportFolder),
      files: fileRows.map(exportFile),
    },
  }))
})

export { router as exportsRouter }
