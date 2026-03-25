import type { Strategy, StrategyPipelineContext, StrategyResult } from '@attestrue/sdk'

/**
 * Minimal destination adapter: no-op pass-through.
 * Replace `run` with outbound HTTP to your ad network or analytics API.
 */
export const minimalDestinationStrategy: Strategy = {
  id: 'example.minimal',
  stage: 'destination',
  manifest: {
    id: 'example.minimal',
    stage: 'destination',
    displayName: 'Minimal example adapter'
  },
  async run(_ctx: StrategyPipelineContext): Promise<StrategyResult> {
    return { continuePipeline: true }
  }
}
