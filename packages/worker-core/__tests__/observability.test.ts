import { describe, expect, it } from 'vitest'
import type { HostKeyValue } from '@attestrack/host-contracts'
import type { ConsentGateResult } from '@attestrack/types'
import {
  appendRequestLog,
  consentLogLabel,
  ingestLogStatus,
  logKeyForHour,
  MAX_LOG_ENTRIES_PER_HOUR,
  LOG_TTL_SECONDS,
  readRecentLogs,
  type RequestLogEntry
} from '../src/observability.js'

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

const NOW = new Date('2026-07-25T10:30:00.000Z')

function entry(n: number, at: Date = NOW): RequestLogEntry {
  return {
    timestamp: at.toISOString(),
    event: `event_${n}`,
    source: 'browser',
    jurisdiction: 'EU',
    consent: 'GRANTED',
    processingTime: n,
    status: 'PROCESSED'
  }
}

describe('request log ring (P3.1)', () => {
  it('appends entries to an hourly UTC key with a bounded TTL', async () => {
    const kv = new MemoryKv()
    await appendRequestLog(kv, entry(1), NOW)
    const key = logKeyForHour(NOW)
    expect(key).toBe('attestrack:obs:log:2026-07-25T10')
    expect(kv.store.has(key)).toBe(true)
    expect(kv.ttls.get(key)).toBe(LOG_TTL_SECONDS)
  })

  it(`caps each hourly ring at ${MAX_LOG_ENTRIES_PER_HOUR} entries, dropping the oldest`, async () => {
    const kv = new MemoryKv()
    for (let i = 0; i < MAX_LOG_ENTRIES_PER_HOUR + 10; i += 1) {
      await appendRequestLog(kv, entry(i), NOW)
    }
    const stored = JSON.parse(kv.store.get(logKeyForHour(NOW)) as string) as RequestLogEntry[]
    expect(stored.length).toBe(MAX_LOG_ENTRIES_PER_HOUR)
    // Oldest (0..9) dropped; newest kept.
    expect(stored[0]?.event).toBe('event_10')
    expect(stored[stored.length - 1]?.event).toBe(`event_${MAX_LOG_ENTRIES_PER_HOUR + 9}`)
  })

  it('reads newest-first across the current and previous hours', async () => {
    const kv = new MemoryKv()
    const prevHour = new Date('2026-07-25T09:45:00.000Z')
    await appendRequestLog(kv, entry(1, prevHour), prevHour)
    await appendRequestLog(kv, entry(2), NOW)
    await appendRequestLog(kv, entry(3), NOW)

    const logs = await readRecentLogs(kv, NOW)
    expect(logs.map((l) => l.event)).toEqual(['event_3', 'event_2', 'event_1'])
  })

  it('honors the read limit', async () => {
    const kv = new MemoryKv()
    for (let i = 0; i < 10; i += 1) await appendRequestLog(kv, entry(i), NOW)
    const logs = await readRecentLogs(kv, NOW, 4)
    expect(logs.length).toBe(4)
    expect(logs[0]?.event).toBe('event_9')
  })

  it('never throws when KV is down (write and read)', async () => {
    const kv = new ThrowingKv()
    await expect(appendRequestLog(kv, entry(1), NOW)).resolves.toBeUndefined()
    await expect(readRecentLogs(kv, NOW)).resolves.toEqual([])
  })

  it('treats a corrupt hourly value as empty and recovers', async () => {
    const kv = new MemoryKv()
    await kv.put(logKeyForHour(NOW), '{corrupt')
    await appendRequestLog(kv, entry(7), NOW)
    const logs = await readRecentLogs(kv, NOW)
    expect(logs.map((l) => l.event)).toEqual(['event_7'])
  })
})

describe('log row labels come from the real consent gate (P3.1)', () => {
  const gate = (over: Partial<ConsentGateResult>): ConsentGateResult => ({
    mode: 'SHADOW',
    mechanism: 'opt-in',
    tokenDecision: null,
    effectiveDecision: null,
    gpcApplied: false,
    wouldAllow: false,
    allowDestinations: true,
    ...over
  })

  it('labels a granted decision', () => {
    expect(consentLogLabel({ consentGate: gate({ effectiveDecision: 'granted' }) })).toBe('GRANTED')
  })

  it('labels an honored GPC signal', () => {
    expect(
      consentLogLabel({ consentGate: gate({ gpcApplied: true, effectiveDecision: 'declined' }) })
    ).toBe('GPC_DECLINED')
  })

  it('labels shadow-mode no-token traffic distinctly', () => {
    expect(consentLogLabel({ consentGate: gate({}) })).toBe('SHADOW_NONE')
  })

  it('labels missing gate as NONE (pipeline without consent strategy)', () => {
    expect(consentLogLabel({})).toBe('NONE')
  })

  it('status reflects bot filtering and enforcement blocks', () => {
    expect(ingestLogStatus({ botDetection: { isBot: true, reasons: ['ua'] } })).toBe('BOT_FILTERED')
    expect(
      ingestLogStatus({
        consentGate: gate({ mode: 'ENFORCEMENT', allowDestinations: false })
      })
    ).toBe('BLOCKED_ENFORCEMENT')
    expect(ingestLogStatus({ consentGate: gate({}) })).toBe('PROCESSED')
  })
})
