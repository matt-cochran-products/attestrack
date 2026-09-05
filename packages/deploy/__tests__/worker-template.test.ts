import { webcrypto } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { KV_KEY_CONSENT_CONFIG, KV_KEY_DRIFT_EXPECTED } from '@attestrack/types'
import { buildWorkerEntry, buildWranglerToml } from '../src/worker-template.js'
import { initialKvSeed } from '../src/kv-schema.js'

describe('worker-template', () => {
  it('includes worker-core handler wiring', () => {
    const src = buildWorkerEntry()
    expect(src).toContain('createAttestrackFetchHandler')
    expect(src).toContain('allBundledStrategies')
  })

  it('emits a Workers VPC binding when a private ClickHouse service is supplied', () => {
    const toml = buildWranglerToml({
      siteId: 'acme:staging',
      kvNamespaceBinding: 'abc',
      clickhouseVpcServiceId: 'service-123'
    })
    expect(toml).toContain('binding = "CLICKHOUSE_PRIVATE"')
    expect(toml).toContain('service_id = "service-123"')
  })

  it('hands ALL string bindings to the host (P6 regression: warehouse/destination secrets must reach host.getSecret)', () => {
    const src = buildWorkerEntry()
    // A scaffold that only forwards CONSENT_TOKEN_SECRET silently disables
    // every credentialed strategy (ClickHouse, Tinybird, ad networks).
    expect(src).toContain('secretValues: stringBindings(env)')
    expect(src).not.toMatch(/secretValues:\s*\{\s*CONSENT_TOKEN_SECRET/)
  })

  it('writes site id into wrangler toml', () => {
    const toml = buildWranglerToml({ siteId: 'acme', kvNamespaceBinding: 'abc' })
    expect(toml).toContain('acme')
    expect(toml).toContain('abc')
  })
})

describe('kv-schema', () => {
  it('seeds consent config key', () => {
    const seed = initialKvSeed('s', 'd')
    expect(Object.keys(seed).some((k) => k.includes('consent_config'))).toBe(true)
  })

  it('P3.5: seeds the drift-expected fingerprint matching the Worker-side hash of the seeded consent config', async () => {
    const seed = initialKvSeed('s', 'd')
    const expected = seed[KV_KEY_DRIFT_EXPECTED]
    expect(expected).toMatch(/^[0-9a-f]{64}$/)

    // Recompute the way the drift-detection strategy does (WebCrypto over the
    // raw KV string) — the two implementations must agree byte-for-byte.
    const raw = seed[KV_KEY_CONSENT_CONFIG] as string
    const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
    expect(expected).toBe(hex)
  })
})
