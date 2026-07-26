import { describe, expect, it } from 'vitest'
import type { HostKeyValue } from '@attestrack/host-contracts'
import { KV_KEY_OBS_DELIVERY_PREFIX, KV_KEY_OBS_EVENTS_PREFIX } from '@attestrack/types'
import {
  DAILY_COUNTER_SAMPLING_THRESHOLD,
  DAILY_COUNTER_TTL_SECONDS,
  incrementDailyCounter,
  readDailyCounter,
  readDeliveryStats,
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

const NOW = new Date('2026-07-25T10:00:00.000Z')

/**
 * Mutation-hardening suite (Stryker): pins the defensive parse fallbacks and
 * the exact sampling/TTL arithmetic of the KV counters — mutants on field
 * fallbacks, the Infinity guard and sampling boundaries survive plain
 * happy-path tests.
 */
describe('readDeliveryStats defensive parsing', () => {
  it('non-object JSON (string/number primitives) parses to null, not a zeroed row', async () => {
    const kv = new MemoryKv()
    kv.store.set(`${KV_KEY_OBS_DELIVERY_PREFIX}ch`, '"just-a-string"')
    expect(await readDeliveryStats(kv, 'ch')).toBeNull()
    kv.store.set(`${KV_KEY_OBS_DELIVERY_PREFIX}ch`, '123')
    expect(await readDeliveryStats(kv, 'ch')).toBeNull()
  })

  it('an empty object normalizes every field to its typed zero — and adds NO undefined keys', async () => {
    const kv = new MemoryKv()
    kv.store.set(`${KV_KEY_OBS_DELIVERY_PREFIX}ch`, '{}')
    const stats = await readDeliveryStats(kv, 'ch')
    expect(stats).toStrictEqual({ ok: 0, error: 0, okToday: 0, errorToday: 0, day: '' })
  })

  it('non-number counter fields and non-string timestamps fall back individually', async () => {
    const kv = new MemoryKv()
    kv.store.set(
      `${KV_KEY_OBS_DELIVERY_PREFIX}ch`,
      JSON.stringify({ ok: '9', error: 2, okToday: null, day: 7, lastOkAt: 123, lastError: 'x' })
    )
    const stats = await readDeliveryStats(kv, 'ch')
    expect(stats).toStrictEqual({ ok: 0, error: 2, okToday: 0, errorToday: 0, day: '', lastError: 'x' })
  })
})

describe('readDailyCounter defensive parsing', () => {
  const key = () => `${KV_KEY_OBS_EVENTS_PREFIX}${utcDay(NOW)}`

  it('corrupt JSON reads as 0', async () => {
    const kv = new MemoryKv()
    kv.store.set(key(), '{not json')
    expect(await readDailyCounter(kv, KV_KEY_OBS_EVENTS_PREFIX, NOW)).toBe(0)
  })

  it('non-finite and non-number counts read as 0 (typeof AND isFinite must both hold)', async () => {
    const kv = new MemoryKv()
    kv.store.set(key(), '{"count":1e999}') // JSON.parse → Infinity: number but not finite
    expect(await readDailyCounter(kv, KV_KEY_OBS_EVENTS_PREFIX, NOW)).toBe(0)
    kv.store.set(key(), '{"count":"5"}')
    expect(await readDailyCounter(kv, KV_KEY_OBS_EVENTS_PREFIX, NOW)).toBe(0)
  })
})

describe('incrementDailyCounter sampling semantics (P3.2)', () => {
  const key = () => `${KV_KEY_OBS_EVENTS_PREFIX}${utcDay(NOW)}`
  const atThreshold = () => {
    const kv = new MemoryKv()
    kv.store.set(key(), JSON.stringify({ count: DAILY_COUNTER_SAMPLING_THRESHOLD }))
    return kv
  }

  it('UNsampled counters never sample, even above the threshold', async () => {
    const kv = atThreshold()
    // random would say "skip" — but sampling must not apply without opt-in.
    await incrementDailyCounter(kv, KV_KEY_OBS_EVENTS_PREFIX, { now: NOW, random: () => 0.99 })
    expect(JSON.parse(kv.store.get(key())!)).toEqual({
      count: DAILY_COUNTER_SAMPLING_THRESHOLD + 1
    })
  })

  it('sampled at the threshold: random() === 0.1 SKIPS the write (>= boundary)', async () => {
    const kv = atThreshold()
    await incrementDailyCounter(kv, KV_KEY_OBS_EVENTS_PREFIX, {
      now: NOW,
      sampled: true,
      random: () => 0.1
    })
    expect(JSON.parse(kv.store.get(key())!)).toEqual({ count: DAILY_COUNTER_SAMPLING_THRESHOLD })
  })

  it('sampled at the threshold: a sub-0.1 roll adds 10 (1-in-10 compensation)', async () => {
    const kv = atThreshold()
    await incrementDailyCounter(kv, KV_KEY_OBS_EVENTS_PREFIX, {
      now: NOW,
      sampled: true,
      random: () => 0.05
    })
    expect(JSON.parse(kv.store.get(key())!)).toEqual({
      count: DAILY_COUNTER_SAMPLING_THRESHOLD + 10
    })
  })

  it('day keys carry the 2-day TTL (exactly 172800 seconds)', async () => {
    const kv = new MemoryKv()
    await incrementDailyCounter(kv, KV_KEY_OBS_EVENTS_PREFIX, { now: NOW })
    expect(DAILY_COUNTER_TTL_SECONDS).toBe(172_800)
    expect(kv.ttls.get(key())).toBe(172_800)
  })
})
