import type { HostKeyValue } from '@attestrack/host-contracts'
import { KV_KEY_OBS_DELIVERY_PREFIX } from '@attestrack/types'

/**
 * P3.1 observability spine: per-strategy delivery outcomes recorded in KV so the
 * portal `/destinations` view and STR.4 error surface show REAL results instead
 * of seeded JSON. Extends the P1 `recordDeliveryError` shape (count + lastError)
 * into success/error totals with a same-UTC-day window.
 *
 * All writers here are BEST-EFFORT and never throw: delivery recording must not
 * take down the hot path (Invariant 12 — analytics/destinations are isolated).
 * KV read-modify-write is racy under concurrency; counts are therefore
 * approximate lower bounds, which the portal labels as such.
 */

/** Stats stored at `attestrack:obs:delivery:{strategyId}`. */
export interface DeliveryStats {
  /** Lifetime successful deliveries (approximate — KV last-write-wins). */
  ok: number
  /** Lifetime failed deliveries (approximate). */
  error: number
  /** Successes recorded during `day` (UTC). */
  okToday: number
  /** Failures recorded during `day` (UTC). */
  errorToday: number
  /** UTC day (`YYYY-MM-DD`) the *Today counters belong to. */
  day: string
  lastOkAt?: string
  lastErrorAt?: string
  /** Truncated last error detail (status line / message). */
  lastError?: string
}

export type DeliveryOutcome = { ok: true } | { ok: false; detail: string }

/** UTC calendar day, `YYYY-MM-DD`. */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

function parseStats(raw: string | null | undefined): DeliveryStats | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<DeliveryStats>
    if (typeof v !== 'object' || v === null) return null
    return {
      ok: typeof v.ok === 'number' ? v.ok : 0,
      error: typeof v.error === 'number' ? v.error : 0,
      okToday: typeof v.okToday === 'number' ? v.okToday : 0,
      errorToday: typeof v.errorToday === 'number' ? v.errorToday : 0,
      day: typeof v.day === 'string' ? v.day : '',
      ...(typeof v.lastOkAt === 'string' ? { lastOkAt: v.lastOkAt } : {}),
      ...(typeof v.lastErrorAt === 'string' ? { lastErrorAt: v.lastErrorAt } : {}),
      ...(typeof v.lastError === 'string' ? { lastError: v.lastError } : {})
    }
  } catch {
    return null
  }
}

/** Read delivery stats for one strategy id (null when never recorded). Never throws. */
export async function readDeliveryStats(
  kv: HostKeyValue,
  strategyId: string
): Promise<DeliveryStats | null> {
  try {
    return parseStats(await kv.get(`${KV_KEY_OBS_DELIVERY_PREFIX}${strategyId}`))
  } catch {
    return null
  }
}

/**
 * Record one delivery attempt outcome for a strategy. Rolls the same-day window
 * when the UTC day changed. Best-effort — never throws.
 */
export async function recordDeliveryResult(
  kv: HostKeyValue,
  strategyId: string,
  outcome: DeliveryOutcome,
  now: Date = new Date()
): Promise<void> {
  try {
    const key = `${KV_KEY_OBS_DELIVERY_PREFIX}${strategyId}`
    const day = utcDay(now)
    const prev = parseStats(await kv.get(key))
    const sameDay = prev !== null && prev.day === day
    const next: DeliveryStats = {
      ok: (prev?.ok ?? 0) + (outcome.ok ? 1 : 0),
      error: (prev?.error ?? 0) + (outcome.ok ? 0 : 1),
      okToday: (sameDay ? prev.okToday : 0) + (outcome.ok ? 1 : 0),
      errorToday: (sameDay ? prev.errorToday : 0) + (outcome.ok ? 0 : 1),
      day,
      ...(outcome.ok
        ? { lastOkAt: now.toISOString() }
        : prev?.lastOkAt !== undefined
          ? { lastOkAt: prev.lastOkAt }
          : {}),
      ...(!outcome.ok
        ? { lastErrorAt: now.toISOString(), lastError: outcome.detail.slice(0, 500) }
        : {
            ...(prev?.lastErrorAt !== undefined ? { lastErrorAt: prev.lastErrorAt } : {}),
            ...(prev?.lastError !== undefined ? { lastError: prev.lastError } : {})
          })
    }
    await kv.put(key, JSON.stringify(next))
  } catch {
    /* best-effort — recording must never break delivery */
  }
}

/** TTL for per-day counter keys: 2 days keeps "today" queryable across the UTC boundary. */
export const DAILY_COUNTER_TTL_SECONDS = 2 * 24 * 60 * 60

/**
 * Beyond this many recorded events per day the counter switches to 1-in-10
 * sampling (adds 10 with probability 0.1) to bound KV write cost on the hot
 * path (P3.2). Counts above the threshold are therefore approximate.
 */
export const DAILY_COUNTER_SAMPLING_THRESHOLD = 5000

export interface IncrementDailyCounterOptions {
  now?: Date
  /** Injectable RNG for tests. */
  random?: () => number
  /** Apply 1-in-10 sampling above {@link DAILY_COUNTER_SAMPLING_THRESHOLD} (default false). */
  sampled?: boolean
}

function counterKey(prefix: string, now: Date): string {
  return `${prefix}${utcDay(now)}`
}

function parseCount(raw: string | null | undefined): number {
  if (!raw) return 0
  try {
    const v = JSON.parse(raw) as { count?: unknown }
    return typeof v.count === 'number' && Number.isFinite(v.count) ? v.count : 0
  } catch {
    return 0
  }
}

/**
 * Increment a per-UTC-day counter key (`${prefix}YYYY-MM-DD`). Day keys expire
 * via TTL, so there is no roll-over logic. Best-effort — never throws; counts
 * are approximate lower bounds under concurrent writers.
 */
export async function incrementDailyCounter(
  kv: HostKeyValue,
  prefix: string,
  options: IncrementDailyCounterOptions = {}
): Promise<void> {
  try {
    const now = options.now ?? new Date()
    const key = counterKey(prefix, now)
    const count = parseCount(await kv.get(key))
    let add = 1
    if (options.sampled === true && count >= DAILY_COUNTER_SAMPLING_THRESHOLD) {
      const random = options.random ?? Math.random
      if (random() >= 0.1) return
      add = 10
    }
    await kv.put(key, JSON.stringify({ count: count + add }), {
      expirationTtl: DAILY_COUNTER_TTL_SECONDS
    })
  } catch {
    /* best-effort */
  }
}

/** Read a per-UTC-day counter (0 when absent). Never throws. */
export async function readDailyCounter(
  kv: HostKeyValue,
  prefix: string,
  now: Date = new Date()
): Promise<number> {
  try {
    return parseCount(await kv.get(counterKey(prefix, now)))
  } catch {
    return 0
  }
}
