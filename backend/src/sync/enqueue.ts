import { randomUUID } from 'node:crypto'
import { db } from '../db/index.js'
import { zettelSyncOutbox } from '../db/schema.js'

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

// Inserted in the same db.transaction() as the domain write it reports -
// if this insert fails, the whole transaction (including the file/folder
// change itself) rolls back with it, matching zettel's own
// insertBacklinkEvent() convention. `id`/`correlationId` must both be
// real UUIDs (the shared envelope schema requires it) - reusing the same
// freshly generated UUID for both, like zettel's own outbox inserts do,
// since correlationId here just satisfies the schema rather than linking
// business entities across events (the entity id - e.g. noteId - lives
// inside `payload` instead).
export function enqueueZettelSyncEvent(
  tx: Executor, eventType: string, ownerUserId: string, payload: unknown,
): void {
  const id = randomUUID()
  const now = Date.now()
  tx.insert(zettelSyncOutbox).values({
    id,
    eventType,
    ownerUserId,
    payload: JSON.stringify(payload),
    correlationId: id,
    state: 'pending',
    createdAt: now,
    attempts: 0,
    nextAttemptAt: now,
    leaseId: null,
    leaseUntil: null,
    deliveredAt: null,
    lastError: null,
  }).run()
}
