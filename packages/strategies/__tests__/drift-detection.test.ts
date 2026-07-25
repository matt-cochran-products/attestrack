import { describe, expect, it } from 'vitest'
import { createMockHostRuntime } from '@attestrack/sdk'
import {
  KV_KEY_CONSENT_CONFIG,
  KV_KEY_DRIFT_CURRENT,
  KV_KEY_DRIFT_EXPECTED,
  KV_KEY_DRIFT_MISMATCH
} from '@attestrack/types'
import { createDriftDetectionStrategy } from '../src/drift/detection.js'

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

describe('drift detection (P3.5)', () => {
  it('records no mismatch when the consent config matches the expected fingerprint', async () => {
    const host = createMockHostRuntime()
    const config = '{"v":1}'
    await host.kv.put(KV_KEY_CONSENT_CONFIG, config)
    await host.kv.put(KV_KEY_DRIFT_EXPECTED, await sha256Hex(config))

    await createDriftDetectionStrategy().run({ host, request: new Request('https://x/') } as never)

    expect(await host.kv.get(KV_KEY_DRIFT_MISMATCH)).toBeNull()
    expect(await host.kv.get(KV_KEY_DRIFT_CURRENT)).toBe(await sha256Hex(config))
  })

  it('writes attestrack:drift:mismatch when the config changed after deploy', async () => {
    const host = createMockHostRuntime()
    await host.kv.put(KV_KEY_CONSENT_CONFIG, '{"v":2,"tampered":true}')
    await host.kv.put(KV_KEY_DRIFT_EXPECTED, await sha256Hex('{"v":1}'))

    await createDriftDetectionStrategy().run({ host, request: new Request('https://x/') } as never)

    const raw = await host.kv.get(KV_KEY_DRIFT_MISMATCH)
    expect(raw).toBeTruthy()
    const mismatch = JSON.parse(raw as string) as { at: string; expected: string; current: string }
    expect(mismatch.expected).toBe(await sha256Hex('{"v":1}'))
    expect(mismatch.current).toBe(await sha256Hex('{"v":2,"tampered":true}'))
    expect(Date.parse(mismatch.at)).not.toBeNaN()
  })

  it('never evaluates drift when no expected fingerprint is set (pre-P3.5 deployments)', async () => {
    const host = createMockHostRuntime()
    await host.kv.put(KV_KEY_CONSENT_CONFIG, '{"v":1}')
    await createDriftDetectionStrategy().run({ host, request: new Request('https://x/') } as never)
    expect(await host.kv.get(KV_KEY_DRIFT_MISMATCH)).toBeNull()
  })
})
