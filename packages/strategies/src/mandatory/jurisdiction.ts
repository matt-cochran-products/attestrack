import type { Strategy, StrategyPipelineContext, StrategyResult } from '@attestrack/sdk'
import { consentConfigSchema } from '@attestrack/schema'
import type { ConsentConfig, StrategyManifest } from '@attestrack/types'
import { COMMUNITY_DEFAULT_CONSENT_CONFIG, KV_KEY_CONSENT_CONFIG } from '@attestrack/types'

/** EU member states (ISO 3166-1 alpha-2) for coarse `EU` row resolution. */
const EU_MEMBER_STATES = new Set([
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE'
])

function resolveJurisdictionKey(geo: string | null, config: ConsentConfig): string {
  if (!geo) return 'DEFAULT'
  const cc = geo.toUpperCase()
  if (config.jurisdictions[cc]) return cc
  if (EU_MEMBER_STATES.has(cc) && config.jurisdictions.EU) return 'EU'
  return 'DEFAULT'
}

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
    let config: ConsentConfig = COMMUNITY_DEFAULT_CONSENT_CONFIG
    const raw = await ctx.host.kv.get(KV_KEY_CONSENT_CONFIG)
    if (raw) {
      try {
        const parsedJson: unknown = JSON.parse(raw)
        const parsed = consentConfigSchema.safeParse(parsedJson)
        if (parsed.success) {
          config = parsed.data as ConsentConfig
        }
      } catch {
        /* keep default */
      }
    }
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
