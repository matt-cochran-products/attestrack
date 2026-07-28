import { describe, expect, it } from 'vitest'
import { parseKvNamespaceIdFromWranglerToml } from '../src/parse-wrangler-toml.js'

describe('parseKvNamespaceIdFromWranglerToml', () => {
  it('returns id after ATTESTRACK_KV binding', () => {
    const toml = `
[[kv_namespaces]]
binding = "ATTESTRACK_KV"
id = "abc-123-def"
`
    expect(parseKvNamespaceIdFromWranglerToml(toml)).toBe('abc-123-def')
  })

  it('returns null for placeholder ids', () => {
    expect(
      parseKvNamespaceIdFromWranglerToml(
        'binding = "ATTESTRACK_KV"\nid = "REPLACE_WITH_KV_NAMESPACE_ID"'
      )
    ).toBeNull()
  })
})
