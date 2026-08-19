import { mkdirSync, chmodSync, openSync, writeSync, closeSync, rmSync, renameSync, createReadStream } from 'node:fs'
import { resolve, relative, join, dirname } from 'node:path'
import { Readable } from 'node:stream'

// Filesystem safety helpers, mirroring the pattern schlussel's export-job
// worker already established (private directory/file modes, resolve()+
// relative() path-traversal guards) - the one real difference is these
// files are permanent (no TTL/expiry sweep), not temporary export
// artifacts, so there's no cleanup-on-schedule counterpart here.

const DATA_DIR = process.env['DATA_DIR'] ?? './data'
const FILES_DIR = resolve(DATA_DIR, 'files')

function ensurePrivateDirectory(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  chmodSync(path, 0o700)
}

// One directory per owner keeps a user's files physically grouped and
// makes a future "delete this account's data" sweep a single rmSync.
export function ownerDirectory(ownerUserId: string): string {
  const root = resolve(FILES_DIR)
  const directory = resolve(root, ownerUserId)
  if (relative(root, directory).startsWith('..') || directory === root) {
    throw new Error('Invalid owner storage path')
  }
  return directory
}

// The path a given file id's bytes live at - never derived from the
// file's own (user-editable) name, so a rename never touches the
// filesystem and can never traverse outside the owner's directory
// regardless of what name a caller supplies elsewhere.
export function storagePathFor(ownerUserId: string, fileId: string): string {
  return join(ownerDirectory(ownerUserId), fileId)
}

export function isSafeStoragePath(ownerUserId: string, storagePath: string): boolean {
  const root = ownerDirectory(ownerUserId)
  const path = resolve(storagePath)
  const rel = relative(root, path)
  return rel !== '' && !rel.startsWith('..')
}

// Writes the whole buffer atomically: a temp file first (exclusive
// create, so two concurrent writers for the same id can never
// interleave), then an atomic rename into place. `wx` also means a
// pre-existing file at the temp path fails loudly instead of silently
// truncating - it should never exist, since file ids are fresh per
// upload.
export function writeFileBytes(path: string, bytes: Uint8Array) {
  ensurePrivateDirectory(dirname(path))
  const tempPath = `${path}.tmp`
  const descriptor = openSync(tempPath, 'wx', 0o600)
  try {
    writeSync(descriptor, bytes)
  } finally {
    closeSync(descriptor)
  }
  rmSync(path, { force: true })
  renameSync(tempPath, path)
}

export function readFileStream(path: string): ReadableStream<Uint8Array> {
  return Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>
}

export function deleteFileBytes(path: string) {
  rmSync(path, { force: true })
}
