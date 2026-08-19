import type { Folder, FileRecord } from '../db/schema.js'

// Never includes storagePath - that's an internal filesystem detail
// (see lib/storage.ts), not something a client should ever see or
// depend on.
export function folderJson(folder: Folder) {
  return { id: folder.id, name: folder.name, parentId: folder.parentId, createdAt: folder.createdAt }
}

export function fileJson(file: FileRecord) {
  return {
    id: file.id,
    name: file.name,
    folderId: file.folderId,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  }
}
