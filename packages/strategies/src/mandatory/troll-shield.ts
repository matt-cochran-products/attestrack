import type { Strategy, StrategyPipelineContext, StrategyResult } from '@attestrue/sdk'
import type { StrategyManifest } from '@attestrue/types'

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
