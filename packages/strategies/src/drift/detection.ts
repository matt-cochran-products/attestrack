import type { Strategy } from '@attestrue/sdk'
import type { StrategyManifest } from '@attestrue/types'
import { KV_KEY_CONSENT_CONFIG, KV_KEY_DRIFT_CURRENT, KV_KEY_DRIFT_EXPECTED } from '@attestrue/types'

const manifest: StrategyManifest = {
  id: 'drift-detection',
  stage: 'analytics',
  displayName: 'Configuration drift detection'
}

async function sha256Hex(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text)
  const buf = await crypto.subtle.digest('SHA-256', enc)
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function createDriftDetectionStrategy(): Strategy {
  return {
    id: 'drift-detection',
    stage: 'analytics',
    manifest,
    async run(ctx) {
      const expected = await ctx.host.kv.get(KV_KEY_DRIFT_EXPECTED)
      const consentRaw = (await ctx.host.kv.get(KV_KEY_CONSENT_CONFIG)) ?? ''
      const hash = await sha256Hex(consentRaw)
      await ctx.host.kv.put(KV_KEY_DRIFT_CURRENT, hash)
      if (expected && hash !== expected) {
        await ctx.host.kv.put(
          'attestrack:drift:mismatch',
          JSON.stringify({
            at: new Date().toISOString(),
            expected,
            current: hash
          }),
          { expirationTtl: 3600 }
        )
      }
      return { continuePipeline: true }
    }
  }
}
