import { eq } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { db } from '../db/index.js'
import { folders, syncFolders, type Folder } from '../db/schema.js'
import { getOwnedFolder, nameTaken } from './folders.js'

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

const ZETTEL_FOLDER_NAME = 'zettel'

// Finds (or creates) the owner's auto-created root "zettel" folder,
// tracked by a stable id in sync_folders rather than re-derived by name
// on every call - renaming or moving that folder must not cause a
// second, orphaned one to appear the next time a note is mirrored.
export function ensureZettelFolder(tx: Executor, ownerUserId: string): Folder {
  const pointer = tx.select().from(syncFolders).where(eq(syncFolders.ownerUserId, ownerUserId)).get()
  if (pointer) {
    const folder = getOwnedFolder(tx, ownerUserId, pointer.folderId)
    if (folder) return folder
    // The pointed-to folder is gone (e.g. the user deleted it, which
    // un-mirrors its notes first - see folders/router.ts's recursive
    // delete) - fall through to recreate a fresh one below.
  }

  const name = nameTaken(tx, ownerUserId, null, ZETTEL_FOLDER_NAME)
    // A file or folder unrelated to this sync already occupies the exact
    // name at root (e.g. the user made one by hand first) - disambiguate
    // rather than fail outright.
    ? `${ZETTEL_FOLDER_NAME} (${createId().slice(0, 6)})`
    : ZETTEL_FOLDER_NAME

  const folder: Folder = { id: createId(), ownerUserId, parentId: null, name, createdAt: new Date() }
  tx.insert(folders).values(folder).run()

  if (pointer) {
    tx.update(syncFolders).set({ folderId: folder.id }).where(eq(syncFolders.ownerUserId, ownerUserId)).run()
  } else {
    tx.insert(syncFolders).values({ ownerUserId, folderId: folder.id, createdAt: new Date() }).run()
  }

  return folder
}

// Read-only check used by the upload route to decide mirror-eligibility -
// never creates the folder itself (an upload into some other, unrelated
// folder must not conjure a "zettel" folder into existence).
export function isZettelFolder(tx: Executor, ownerUserId: string, folderId: string | null): boolean {
  if (folderId === null) return false
  const pointer = tx.select().from(syncFolders).where(eq(syncFolders.ownerUserId, ownerUserId)).get()
  return pointer?.folderId === folderId
}
