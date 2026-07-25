import type { Strategy, StrategyPipelineContext, StrategyResult } from '@attestrack/sdk'
import type { StrategyManifest } from '@attestrack/types'

export const communityTrollShieldStrategyManifest: StrategyManifest = {
  id: 'troll-shield',
  stage: 'mandatory',
  displayName: 'Troll shield (community)'
}

export const communityTrollShieldStrategy: Strategy = {
  id: 'troll-shield',
  stage: 'mandatory',
  manifest: communityTrollShieldStrategyManifest,
  async run(_ctx: StrategyPipelineContext): Promise<StrategyResult> {
    return { continuePipeline: true }
  }
}
