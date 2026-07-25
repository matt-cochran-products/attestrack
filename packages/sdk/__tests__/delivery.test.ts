import { describe, expect, it } from 'vitest'
import type { HostKeyValue } from '@attestrack/host-contracts'
import { KV_KEY_OBS_DELIVERY_PREFIX, KV_KEY_OBS_EVENTS_PREFIX } from '@attestrack/types'
import {
  DAILY_COUNTER_SAMPLING_THRESHOLD,
  DAILY_COUNTER_TTL_SECONDS,
  incrementDailyCounter,
  readDailyCounter,
  readDeliveryStats,
  recordDeliveryResult,
  utcDay
} from '../src/delivery.js'

class MemoryKv implements HostKeyValue {
  readonly store = new Map<string, string>()
  readonly ttls = new Map<string, number | undefined>()
  async get(key: string) {
    return this.store.get(key) ?? null
  }
  async put(key: string, value: string, options?: { expirationTtl?: number }) {
    this.store.set(key, value)
    this.ttls.set(key, options?.expirationTtl)
  }
  async delete(key: string) {
    this.store.delete(key)
  }
}

class ThrowingKv implements HostKeyValue {
  async get(): Promise<string> {
    throw new Error('kv down')
  }
  async put(): Promise<void> {
    throw new Error('kv down')
  }
  async delete(): Promise<void> {
    throw new Error('kv down')
  }
}

const NOW = new Date('2026-07-25T10:00:00.000Z')

describe('recordDeliveryResult / readDeliveryStats (P3.1)', () => {
  it('accumulates ok and error counts with last timestamps and truncated detail', async () => {
    const kv = new MemoryKv()
    await recordDeliveryResult(kv, 'clickhouse', { ok: true }, NOW)
    await recordDeliveryResult(kv, 'clickhouse', { ok: false, detail: 'HTTP 500' }, NOW)
    await recordDeliveryResult(kv, 'clickhouse', { ok: true }, NOW)

    const stats = await readDeliveryStats(kv, 'clickhouse')
    expect(stats).not.toBeNull()
    expect(stats?.ok).toBe(2)
    expect(stats?.error).toBe(1)
    expect(stats?.okToday).toBe(2)
    expect(stats?.errorToday).toBe(1)
    expect(stats?.day).toBe('2026-07-25')
    expect(stats?.lastOkAt).toBe(NOW.toISOString())
    expect(stats?.lastErrorAt).toBe(NOW.toISOString())
    expect(stats?.lastError).toBe('HTTP 500')
  })

  it('truncates long error detail to 500 chars', async () => {
    const kv = new MemoryKv()
    await recordDeliveryResult(kv, 'tinybird', { ok: false, detail: 'x'.repeat(2000) }, NOW)
    const stats = await readDeliveryStats(kv, 'tinybird')
    expect(stats?.lastError?.length).toBe(500)
  })

  it('rolls the same-day window across UTC days but keeps lifetime totals', async () => {
    const kv = new MemoryKv()
    await recordDeliveryResult(kv, 'meta-capi', { ok: true }, NOW)
    await recordDeliveryResult(kv, 'meta-capi', { ok: false, detail: 'HTTP 400' }, NOW)
    const nextDay = new Date('2026-07-26T00:05:00.000Z')
    await recordDeliveryResult(kv, 'meta-capi', { ok: true }, nextDay)

    const stats = await readDeliveryStats(kv, 'meta-capi')
    expect(stats?.ok).toBe(2)
    expect(stats?.error).toBe(1)
    expect(stats?.day).toBe('2026-07-26')
    expect(stats?.okToday).toBe(1)
    expect(stats?.errorToday).toBe(0)
    // Last error info survives the day roll (STR.4 error surface).
    expect(stats?.lastError).toBe('HTTP 400')
  })

  it('preserves lastOkAt across a subsequent failure', async () => {
    const kv = new MemoryKv()
    await recordDeliveryResult(kv, 'otel', { ok: true }, NOW)
    const later = new Date('2026-07-25T11:00:00.000Z')
    await recordDeliveryResult(kv, 'otel', { ok: false, detail: 'HTTP 503' }, later)
    const stats = await readDeliveryStats(kv, 'otel')
    expect(stats?.lastOkAt).toBe(NOW.toISOString())
    expect(stats?.lastErrorAt).toBe(later.toISOString())
  })

  it('uses the registry delivery key prefix', async () => {
    const kv = new MemoryKv()
    await recordDeliveryResult(kv, 'clickhouse', { ok: true }, NOW)
    expect(kv.store.has(`${KV_KEY_OBS_DELIVERY_PREFIX}clickhouse`)).toBe(true)
  })

  it('never throws when KV is down (hot-path safety)', async () => {
    const kv = new ThrowingKv()
    await expect(
      recordDeliveryResult(kv, 'clickhouse', { ok: false, detail: 'x' }, NOW)
    ).resolves.toBeUndefined()
    await expect(readDeliveryStats(kv, 'clickhouse')).resolves.toBeNull()
  })

  it('returns null for absent or corrupt stats', async () => {
    const kv = new MemoryKv()
    expect(await readDeliveryStats(kv, 'nope')).toBeNull()
    await kv.put(`${KV_KEY_OBS_DELIVERY_PREFIX}bad`, 'not json')
    expect(await readDeliveryStats(kv, 'bad')).toBeNull()
  })
})

describe('incrementDailyCounter / readDailyCounter (P3.2)', () => {
  it('increments a per-UTC-day key with a bounded TTL', async () => {
    const kv = new MemoryKv()
    await incrementDailyCounter(kv, KV_KEY_OBS_EVENTS_PREFIX, { now: NOW })
    await incrementDailyCounter(kv, KV_KEY_OBS_EVENTS_PREFIX, { now: NOW })
    expect(await readDailyCounter(kv, KV_KEY_OBS_EVENTS_PREFIX, NOW)).toBe(2)
    const key = `${KV_KEY_OBS_EVENTS_PREFIX}${utcDay(NOW)}`
    expect(kv.ttls.get(key)).toBe(DAILY_COUNTER_TTL_SECONDS)
  })

  it('keeps separate counts per UTC day', async () => {
    const kv = new MemoryKv()
    await incrementDailyCounter(kv, KV_KEY_OBS_EVENTS_PREFIX, { now: NOW })
    const nextDay = new Date('2026-07-26T00:00:01.000Z')
    await incrementDailyCounter(kv, KV_KEY_OBS_EVENTS_PREFIX, { now: nextDay })
    expect(await readDailyCounter(kv, KV_KEY_OBS_EVENTS_PREFIX, NOW)).toBe(1)
    expect(await readDailyCounter(kv, KV_KEY_OBS_EVENTS_PREFIX, nextDay)).toBe(1)
  })

  it('samples 1-in-10 (weight 10) above the threshold when sampling is enabled', async () => {
    const kv = new MemoryKv()
    const key = `${KV_KEY_OBS_EVENTS_PREFIX}${utcDay(NOW)}`
    await kv.put(key, JSON.stringify({ count: DAILY_COUNTER_SAMPLING_THRESHOLD }))

    // random ≥ 0.1 → skipped entirely (no write)
    await incrementDailyCounter(kv, KV_KEY_OBS_EVENTS_PREFIX, {
      now: NOW,
      sampled: true,
      random: () => 0.9
    })
    expect(await readDailyCounter(kv, KV_KEY_OBS_EVENTS_PREFIX, NOW)).toBe(
      DAILY_COUNTER_SAMPLING_THRESHOLD
    )

    // random < 0.1 → adds the sampling weight 10
    await incrementDailyCounter(kv, KV_KEY_OBS_EVENTS_PREFIX, {
      now: NOW,
      sampled: true,
      random: () => 0.05
    })
    expect(await readDailyCounter(kv, KV_KEY_OBS_EVENTS_PREFIX, NOW)).toBe(
      DAILY_COUNTER_SAMPLING_THRESHOLD + 10
    )
  })

  it('always increments by 1 below the threshold even when sampling is enabled', async () => {
    const kv = new MemoryKv()
    await incrementDailyCounter(kv, KV_KEY_OBS_EVENTS_PREFIX, {
      now: NOW,
      sampled: true,
      random: () => 0.99
    })
    expect(await readDailyCounter(kv, KV_KEY_OBS_EVENTS_PREFIX, NOW)).toBe(1)
  })

  it('never throws when KV is down and reads 0', async () => {
    const kv = new ThrowingKv()
    await expect(
      incrementDailyCounter(kv, KV_KEY_OBS_EVENTS_PREFIX, { now: NOW })
    ).resolves.toBeUndefined()
    await expect(readDailyCounter(kv, KV_KEY_OBS_EVENTS_PREFIX, NOW)).resolves.toBe(0)
  })

  it('treats corrupt counter values as 0', async () => {
    const kv = new MemoryKv()
    const key = `${KV_KEY_OBS_EVENTS_PREFIX}${utcDay(NOW)}`
    await kv.put(key, '{"count":"NaN-ish"}')
    await incrementDailyCounter(kv, KV_KEY_OBS_EVENTS_PREFIX, { now: NOW })
    expect(await readDailyCounter(kv, KV_KEY_OBS_EVENTS_PREFIX, NOW)).toBe(1)
  })
})
