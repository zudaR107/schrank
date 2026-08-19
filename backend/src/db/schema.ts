import { sqliteTable, text, integer, index, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

// Every timestamp column here uses `mode: 'timestamp_ms'`, not the more
// common `mode: 'timestamp'` - the latter stores epoch *seconds*
// (Math.floor(ms / 1000)) and truncates sub-second precision on every
// round-trip through the DB. Both modes map to the same SQL `integer`
// column type - this is a pure application-level interpretation choice.

// ── Users (mirrored from Schlüssel via JWT) ───────────────────────
// We store only the user id from the JWT - no passwords here.
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export type User = typeof users.$inferSelect

// ── Folders ──────────────────────────────────────────────────────
// parentId null = the owner's root. The self-referencing FK has
// onDelete: 'cascade' so deleting a folder recursively deletes every
// descendant folder row at the SQLite level (foreign_keys = ON, set in
// db/index.ts) - the router only has to separately collect and delete
// affected files' on-disk bytes (and their own rows, also cascaded)
// *before* issuing the delete, since cascade only cleans up DB rows,
// never filesystem content it doesn't know about.
//
// Name uniqueness within a parent and no-cycle-on-move are both
// enforced in application code (see features/folders/router.ts) inside
// the same transaction as the write - a partial unique index on a
// nullable parentId is awkward in SQLite, and cycle detection (walking
// the move target's own ancestors) isn't expressible as a constraint at
// all.
export const folders = sqliteTable('folders', {
  id: text('id').primaryKey(),
  ownerUserId: text('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  parentId: text('parent_id').references((): AnySQLiteColumn => folders.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
  index('folders_owner_parent_idx').on(table.ownerUserId, table.parentId),
])

export type Folder = typeof folders.$inferSelect

// ── Files ────────────────────────────────────────────────────────
// folderId null = the owner's root; cascades the same way as folders
// above when its parent folder is deleted. storagePath is the on-disk
// location of the actual bytes (under DATA_DIR/files/<ownerUserId>/<id>,
// see lib/storage.ts) - never derived from user-supplied name/path
// input, so renaming a file never touches the filesystem.
export const files = sqliteTable('files', {
  id: text('id').primaryKey(),
  ownerUserId: text('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  folderId: text('folder_id').references(() => folders.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  storagePath: text('storage_path').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
  index('files_owner_folder_idx').on(table.ownerUserId, table.folderId),
])

export type FileRecord = typeof files.$inferSelect
