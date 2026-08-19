import { eq, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { files } from '../db/schema.js'

// Personal-scale defaults (self-hosted, single household) - both
// configurable per-deployment via env vars, matching the platform's
// existing convention for tunable limits (e.g. schlussel's export
// quotas).
export const MAX_FILE_BYTES = Number(process.env['MAX_FILE_BYTES'] ?? 200 * 1024 * 1024)
export const MAX_BYTES_PER_USER = Number(process.env['MAX_BYTES_PER_USER'] ?? 2 * 1024 * 1024 * 1024)

export function usedBytes(ownerUserId: string): number {
  const row = db.select({ total: sql<number>`coalesce(sum(${files.sizeBytes}), 0)` })
    .from(files)
    .where(eq(files.ownerUserId, ownerUserId))
    .get()
  return row?.total ?? 0
}
