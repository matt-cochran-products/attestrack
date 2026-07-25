import { z } from 'zod'
import { ATTESTRACK_EXPLORE_CHART_TYPES } from '@attestrack/types'

/**
 * Saved Explore queries — Zod-validated KV shape (P4.4, INV-B-17, EXP.9/EXP.10).
 *
 * The whole list lives under `attestrack:portal:saved_queries`
 * (`KV_KEY_PORTAL_SAVED_QUERIES`) in the CUSTOMER's CF KV. Pins are per-user:
 * `user` is the `Cf-Access-Authenticated-User-Email` request header value
 * (Cloudflare Access is assumed in front of the portal API — PORTAL.1).
 * Without Access the header is absent and pins fall back to a single shared
 * anonymous user (`''`) — documented in REPO-SPEC-OSS.
 */

/** Chart configuration captured when the user pins a query (EXP.8: user-directed). */
export const savedQueryChartConfigSchema = z
  .object({
    chartType: z.enum(ATTESTRACK_EXPLORE_CHART_TYPES),
    /** Column driving the x axis / category / heatmap x. */
    xColumn: z.string().min(1).max(200).optional(),
    /** Column driving the y value / heatmap y. */
    yColumn: z.string().min(1).max(200).optional(),
    /** Heatmap cell value column (heatmap only). */
    valueColumn: z.string().min(1).max(200).optional()
  })
  .strict()

export type SavedQueryChartConfig = z.infer<typeof savedQueryChartConfigSchema>

/** One user's pin on a saved query (EXP.10 — personal, not shared by default). */
export const savedQueryPinSchema = z
  .object({
    /** `Cf-Access-Authenticated-User-Email`; `''` when no Access identity exists. */
    user: z.string().max(320),
    pinnedAt: z.string().min(1),
    chart: savedQueryChartConfigSchema
  })
  .strict()

export type SavedQueryPin = z.infer<typeof savedQueryPinSchema>

export const savedQueryEntrySchema = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(120),
    sql: z.string().min(1).max(10_000),
    updatedAt: z.string().min(1),
    pins: z.array(savedQueryPinSchema).max(50).optional()
  })
  .strict()

export type SavedQueryEntryV1 = z.infer<typeof savedQueryEntrySchema>

/** Bounded list — the portal API rejects saves beyond this cap. */
export const SAVED_QUERIES_MAX_ENTRIES = 100

export const savedQueriesKvSchema = z.array(savedQueryEntrySchema).max(SAVED_QUERIES_MAX_ENTRIES)

/**
 * Parse the raw KV value. Entries that fail validation are dropped individually
 * (a single corrupt row must not take down the whole saved-queries surface);
 * non-JSON / non-array values parse to `[]`.
 */
export function parseSavedQueriesKv(raw: string | null | undefined): SavedQueryEntryV1[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: SavedQueryEntryV1[] = []
  for (const item of parsed) {
    const r = savedQueryEntrySchema.safeParse(item)
    if (r.success && out.length < SAVED_QUERIES_MAX_ENTRIES) out.push(r.data)
  }
  return out
}
