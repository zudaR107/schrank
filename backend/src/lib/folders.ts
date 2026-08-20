import { eq, and, isNull, ne, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { folders, files, type Folder } from '../db/schema.js'

// Every helper here accepts either `db` itself or a `tx` from inside a
// db.transaction((tx) => {...}) callback - both expose the same
// synchronous better-sqlite3-backed query builder shape (tx just lacks
// db's own $client handle, hence the union rather than reusing
// `typeof db` directly), so callers that need atomicity with a write
// (see features/folders/router.ts's move/delete handlers) can pass `tx`
// and get a consistent read within the same transaction, while simple
// GET handlers just pass `db`.
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

export function getOwnedFolder(executor: Executor, ownerUserId: string, id: string): Folder | undefined {
  return executor.select().from(folders).where(and(eq(folders.id, id), eq(folders.ownerUserId, ownerUserId))).get()
}

// Root-to-parent chain (excluding the folder itself), for breadcrumb
// rendering. Bounded by however deep the caller has actually nested
// folders - there's no separate depth limit.
export function ancestorsOf(executor: Executor, ownerUserId: string, parentId: string | null): Folder[] {
  const chain: Folder[] = []
  let current = parentId
  const seen = new Set<string>()
  while (current) {
    if (seen.has(current)) break // defensive: a real cycle should never exist, but never loop forever if one somehow does
    seen.add(current)
    const folder = getOwnedFolder(executor, ownerUserId, current)
    if (!folder) break
    chain.unshift(folder)
    current = folder.parentId
  }
  return chain
}

// True when `candidateId` is `folderId` itself or one of its ancestors -
// the check that guards against a move creating a cycle: moving folder
// X to live under Y is only safe when X is not Y itself and not an
// ancestor of Y (i.e. Y doesn't already live inside X's own subtree).
export function isSelfOrAncestor(executor: Executor, ownerUserId: string, candidateId: string, folderId: string): boolean {
  if (candidateId === folderId) return true
  return ancestorsOf(executor, ownerUserId, folderId).some((f) => f.id === candidateId)
}

// Folders and files share one name namespace per directory, like a real
// filesystem - a folder and a file can't both be named "Photos" in the
// same place.
export function nameTaken(
  executor: Executor, ownerUserId: string, parentId: string | null, name: string, excludeFolderId?: string,
): boolean {
  const parentCondition = parentId === null ? isNull(folders.parentId) : eq(folders.parentId, parentId)
  const folderConditions = [eq(folders.ownerUserId, ownerUserId), parentCondition, eq(folders.name, name)]
  if (excludeFolderId) folderConditions.push(ne(folders.id, excludeFolderId))
  const folderMatch = executor.select({ id: folders.id }).from(folders).where(and(...folderConditions)).get()
  if (folderMatch) return true

  const fileParentCondition = parentId === null ? isNull(files.folderId) : eq(files.folderId, parentId)
  const fileMatch = executor.select({ id: files.id }).from(files)
    .where(and(eq(files.ownerUserId, ownerUserId), fileParentCondition, eq(files.name, name)))
    .get()
  return fileMatch !== undefined
}

// Direct children only (subfolders + files) - a folder card's "N
// объектов" badge, not a recursive tree size.
export function itemCountOf(executor: Executor, ownerUserId: string, folderId: string): number {
  const folderCount = executor.select({ count: sql<number>`count(*)` }).from(folders)
    .where(and(eq(folders.ownerUserId, ownerUserId), eq(folders.parentId, folderId))).get()?.count ?? 0
  const fileCount = executor.select({ count: sql<number>`count(*)` }).from(files)
    .where(and(eq(files.ownerUserId, ownerUserId), eq(files.folderId, folderId))).get()?.count ?? 0
  return folderCount + fileCount
}
