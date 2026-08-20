import { createNotificationOutboxRuntime, type NotificationOutboxRow } from '@zudar107/schloss-server-kit'
import { and, asc, eq, isNull, lt, lte, or } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { db } from '../db/index.js'
import { zettelSyncOutbox } from '../db/schema.js'

const SOURCE = 'schrank'
const DEFAULT_ZETTEL_BASE_URL = 'http://zettel-backend:3003'
const MAX_TIMER_VALUE = 2_147_483_647
const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60_000
const MAX_CLEANUP_INTERVAL_MS = 60 * 60_000
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name]
  const value = raw == null || raw === '' ? fallback : Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TIMER_VALUE) {
    throw new Error(`${name} must be a positive integer no greater than ${MAX_TIMER_VALUE}`)
  }
  return value
}

function zettelBaseUrl(): string {
  const raw = process.env['ZETTEL_BASE_URL'] ?? DEFAULT_ZETTEL_BASE_URL
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('ZETTEL_BASE_URL must be a valid HTTP(S) origin')
  }
  if (
    !['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password ||
    (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash
  ) {
    throw new Error('ZETTEL_BASE_URL must be a valid HTTP(S) origin')
  }
  return url.origin
}

function eligibleAt(nowMs: number) {
  // Picks up both never-attempted rows (nextAttemptAt null/due) and rows
  // whose lease expired without a mark* call ever landing (a crash mid-
  // delivery) - either way, eligible for a fresh claim.
  return or(
    and(
      eq(zettelSyncOutbox.state, 'pending'),
      or(isNull(zettelSyncOutbox.nextAttemptAt), lte(zettelSyncOutbox.nextAttemptAt, nowMs)),
    ),
    and(
      eq(zettelSyncOutbox.state, 'inflight'),
      or(isNull(zettelSyncOutbox.leaseUntil), lte(zettelSyncOutbox.leaseUntil, nowMs)),
    ),
  )
}

// Wires schrank's own zettel_sync_outbox table into the shared
// storage-agnostic delivery runtime (@zudar107/schloss-server-kit's
// createNotificationOutboxRuntime), mirroring zettel's own
// notifications/outbox.ts almost verbatim - this file owns the SQLite
// transaction/lease-fencing policy the shared runtime deliberately stays
// agnostic to. Returns a no-op stoppable stub (rather than throwing)
// when the HMAC credentials aren't configured, so a dev/test environment
// without the Zettel integration set up doesn't crash on boot - events
// still get recorded (see features/files/router.ts, features/folders/
// router.ts, sync/inbox.ts), they just queue up undelivered until
// credentials are added.
export function startZettelSyncOutbox() {
  const leaseDurationMs = positiveInteger('SCHRANK_TO_ZETTEL_OUTBOX_LEASE_MS', 30_000)
  const requestTimeoutMs = positiveInteger('SCHRANK_TO_ZETTEL_FETCH_TIMEOUT_MS', 10_000)
  const pollIntervalMs = positiveInteger('SCHRANK_TO_ZETTEL_DISPATCH_INTERVAL_MS', 1_000)
  const stopTimeoutMs = positiveInteger('SCHRANK_TO_ZETTEL_WORKER_STOP_TIMEOUT_MS', 5_000)
  const maxAttempts = positiveInteger('SCHRANK_TO_ZETTEL_MAX_ATTEMPTS', 8)
  const baseDelayMs = positiveInteger('SCHRANK_TO_ZETTEL_RETRY_BASE_DELAY_MS', 1_000)
  const maxDelayMs = positiveInteger('SCHRANK_TO_ZETTEL_RETRY_MAX_DELAY_MS', 15 * 60_000)
  const retentionMs = positiveInteger('SCHRANK_TO_ZETTEL_OUTBOX_RETENTION_MS', DEFAULT_RETENTION_MS)
  const baseUrl = zettelBaseUrl()
  if (requestTimeoutMs >= leaseDurationMs) {
    throw new Error('SCHRANK_TO_ZETTEL_FETCH_TIMEOUT_MS must be shorter than SCHRANK_TO_ZETTEL_OUTBOX_LEASE_MS')
  }
  if (maxDelayMs < baseDelayMs) {
    throw new Error('SCHRANK_TO_ZETTEL_RETRY_MAX_DELAY_MS must be at least SCHRANK_TO_ZETTEL_RETRY_BASE_DELAY_MS')
  }

  const keyId = process.env['SCHRANK_TO_ZETTEL_HMAC_KEY_ID']
  const secret = process.env['SCHRANK_TO_ZETTEL_HMAC_SECRET']
  if (Boolean(keyId) !== Boolean(secret)) {
    throw new Error('Schrank-to-Zettel credentials must configure both key ID and secret')
  }
  if (keyId && secret && !KEY_ID_PATTERN.test(keyId)) {
    throw new Error('SCHRANK_TO_ZETTEL_HMAC_KEY_ID must contain only letters, numbers, dot, underscore, or hyphen')
  }
  if (keyId && secret && Buffer.byteLength(secret) < 32) {
    throw new Error('SCHRANK_TO_ZETTEL_HMAC_SECRET must be at least 32 bytes')
  }

  function pruneTerminalRows(nowMs: number): void {
    const cutoff = nowMs - retentionMs
    db.delete(zettelSyncOutbox).where(or(
      and(
        eq(zettelSyncOutbox.state, 'delivered'),
        lt(zettelSyncOutbox.deliveredAt, cutoff),
      ),
      and(
        eq(zettelSyncOutbox.state, 'permanent'),
        lt(zettelSyncOutbox.permanentAt, cutoff),
      ),
    )).run()
  }

  pruneTerminalRows(Date.now())
  const cleanupTimer = setInterval(() => {
    try {
      pruneTerminalRows(Date.now())
    } catch (error) {
      console.error('[Schrank] Zettel sync outbox retention cleanup failed', error)
    }
  }, Math.min(retentionMs, MAX_CLEANUP_INTERVAL_MS))
  cleanupTimer.unref()

  if (!keyId || !secret) {
    console.warn('[Schrank] SCHRANK_TO_ZETTEL_HMAC_KEY_ID/SECRET not configured - Zettel sync delivery disabled, events will queue undelivered')
    return {
      async stop() {
        clearInterval(cleanupTimer)
      },
    }
  }

  const runtime = createNotificationOutboxRuntime({
    source: SOURCE,
    keyId,
    secret,
    baseUrl,
    leaseDurationMs,
    requestTimeoutMs,
    pollIntervalMs,
    stopTimeoutMs,
    maxAttempts,
    baseDelayMs,
    maxDelayMs,

    async claim({ now, leaseUntil }) {
      const nowMs = now.getTime()
      const leaseId = randomUUID()
      return db.transaction((tx) => {
        const row = tx.select().from(zettelSyncOutbox)
          .where(eligibleAt(nowMs))
          .orderBy(asc(zettelSyncOutbox.createdAt), asc(zettelSyncOutbox.id))
          .limit(1)
          .get()
        if (!row) return null

        tx.update(zettelSyncOutbox)
          .set({ state: 'inflight', leaseId, leaseUntil: leaseUntil.getTime() })
          .where(eq(zettelSyncOutbox.id, row.id))
          .run()

        return {
          id: row.id,
          type: row.eventType,
          occurredAt: new Date(row.createdAt).toISOString(),
          correlationId: row.correlationId,
          payload: JSON.parse(row.payload) as unknown,
          attempts: row.attempts,
          leaseToken: leaseId,
        } satisfies NotificationOutboxRow
      })
    },

    async markDelivered({ id, leaseToken, deliveredAt }) {
      const result = db.update(zettelSyncOutbox).set({
        state: 'delivered', leaseId: null, leaseUntil: null,
        deliveredAt: deliveredAt.getTime(), lastError: null,
      }).where(and(eq(zettelSyncOutbox.id, id), eq(zettelSyncOutbox.leaseId, leaseToken))).run()
      return result.changes > 0
    },

    async markRetry({ id, leaseToken, attempts, nextAttemptAt, error }) {
      const result = db.update(zettelSyncOutbox).set({
        state: 'pending', attempts, nextAttemptAt: nextAttemptAt.getTime(),
        leaseId: null, leaseUntil: null, lastError: error,
      }).where(and(eq(zettelSyncOutbox.id, id), eq(zettelSyncOutbox.leaseId, leaseToken))).run()
      return result.changes > 0
    },

    async markPermanent({ id, leaseToken, attempts, error }) {
      const result = db.update(zettelSyncOutbox).set({
        state: 'permanent', attempts, nextAttemptAt: null,
        leaseId: null, leaseUntil: null, permanentAt: Date.now(), lastError: error,
      }).where(and(eq(zettelSyncOutbox.id, id), eq(zettelSyncOutbox.leaseId, leaseToken))).run()
      return result.changes > 0
    },
  })

  runtime.start()
  return {
    ...runtime,
    async stop() {
      clearInterval(cleanupTimer)
      await runtime.stop()
    },
  }
}
