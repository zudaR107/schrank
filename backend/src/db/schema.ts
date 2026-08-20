import { sqliteTable, text, integer, index, primaryKey, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

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

// ── Zettel sync ──────────────────────────────────────────────────
// Mirrors Zettel notes as .md files in a per-owner "zettel" folder (see
// lib/wellKnownFolder.ts) and reports file-side lifecycle changes back.
// See sync/outbox.ts, sync/inbox.ts.

// Outbound events to Zettel - same shape as Zettel's own
// notification_outbox (notification-runtime.ts is storage-agnostic, this
// table is what wires it in). Timestamp columns are plain epoch-ms
// integers (no timestamp_ms mode) to match that runtime's own
// millisecond-arithmetic (lease timers, backoff) rather than Date objects.
export const zettelSyncOutbox = sqliteTable('zettel_sync_outbox', {
  id: text('id').primaryKey(),
  eventType: text('event_type').notNull(),
  ownerUserId: text('owner_user_id').notNull(),
  payload: text('payload').notNull(),
  correlationId: text('correlation_id').notNull(),
  state: text('state').notNull().default('pending'),
  createdAt: integer('created_at').notNull(),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: integer('next_attempt_at'),
  leaseId: text('lease_id'),
  leaseUntil: integer('lease_until'),
  deliveredAt: integer('delivered_at'),
  permanentAt: integer('permanent_at'),
  lastError: text('last_error'),
}, (table) => [
  index('zettel_sync_outbox_dispatch_idx').on(table.state, table.nextAttemptAt),
])

export type ZettelSyncOutboxRow = typeof zettelSyncOutbox.$inferSelect

// Inbound events from Zettel - dedupe on (source, eventId) so a retried
// delivery (e.g. after a 5xx our own handler already applied) is a
// harmless no-op rather than a duplicate mutation.
export const inboxEvents = sqliteTable('inbox_events', {
  source: text('source').notNull(),
  eventId: text('event_id').notNull(),
  payloadHash: text('payload_hash').notNull(),
  receivedAt: integer('received_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.source, table.eventId] }),
])

// One Schrank file mirrors exactly one Zettel note. fileId is the PK so
// deleting the files row (including via a folder's recursive delete)
// cascades this mapping away automatically; noteId is unique since a
// note is mirrored by at most one file.
export const zettelMirrors = sqliteTable('zettel_mirrors', {
  fileId: text('file_id').primaryKey().references(() => files.id, { onDelete: 'cascade' }),
  noteId: text('note_id').notNull().unique(),
  ownerUserId: text('owner_user_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export type ZettelMirror = typeof zettelMirrors.$inferSelect

// Points each owner at their current auto-created "zettel" folder, so it
// can be found reliably even after being renamed or moved - re-deriving
// "the folder named zettel at root" on every event would create a second
// orphaned folder the moment a user renames or moves the first one.
export const syncFolders = sqliteTable('sync_folders', {
  ownerUserId: text('owner_user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  folderId: text('folder_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})
