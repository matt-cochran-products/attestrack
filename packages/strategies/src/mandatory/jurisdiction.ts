import type { Strategy, StrategyPipelineContext, StrategyResult } from '@attestrack/sdk'
import { parseConsentConfigJson } from '@attestrack/schema'
import type { ConsentConfig, StrategyManifest } from '@attestrack/types'
import {
  COMMUNITY_DEFAULT_CONSENT_CONFIG,
  KV_KEY_CONSENT_CONFIG,
  resolveJurisdictionKey
} from '@attestrack/types'

/**
 * **JurisdictionStrategy** (community): resolves the active row from operator KV
 * `ConsentConfig` using geo/signals. Premium **JurisdictionCompleteStrategy** declares
 * `replaces: ['jurisdiction']` and swaps in without changing KV keys or Worker code.
 */
export const communityJurisdictionStrategyManifest: StrategyManifest = {
  id: 'jurisdiction',
  stage: 'mandatory',
  displayName: 'Jurisdiction resolution (community KV)'
}

export const communityJurisdictionStrategy: Strategy = {
  id: 'jurisdiction',
  stage: 'mandatory',
  manifest: communityJurisdictionStrategyManifest,
  async run(ctx: StrategyPipelineContext): Promise<StrategyResult> {
    const raw = await ctx.host.kv.get(KV_KEY_CONSENT_CONFIG)
    const config = parseConsentConfigJson<ConsentConfig>(raw, COMMUNITY_DEFAULT_CONSENT_CONFIG)
    const key = resolveJurisdictionKey(ctx.host.geoCountry(ctx.request), config)
    const row = config.jurisdictions[key] ?? config.jurisdictions.DEFAULT
    if (!row) {
      ctx.jurisdictionKey = 'DEFAULT'
      ctx.jurisdictionRow = COMMUNITY_DEFAULT_CONSENT_CONFIG.jurisdictions.DEFAULT
      return { continuePipeline: true }
    }
    ctx.jurisdictionKey = key
    ctx.jurisdictionRow = row
    return { continuePipeline: true }
  }
}
