import { describe, expect, it } from 'vitest'
import { buildWorkerEntry, buildWranglerToml } from '../src/worker-template.js'
import { initialKvSeed } from '../src/kv-schema.js'

describe('worker-template', () => {
  it('includes worker-core handler wiring', () => {
    const src = buildWorkerEntry()
    expect(src).toContain('createAttestrackFetchHandler')
    expect(src).toContain('allBundledStrategies')
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
})
