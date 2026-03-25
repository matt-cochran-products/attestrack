import type { Strategy, StrategyPipelineContext, StrategyResult } from '@attestrue/sdk'
import type { StrategyManifest } from '@attestrue/types'

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
  async run(_ctx: StrategyPipelineContext): Promise<StrategyResult> {
    return { continuePipeline: true }
  }
}
