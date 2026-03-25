import type { Strategy, StrategyPipelineContext, StrategyResult } from '@attestrue/sdk'

/** Placeholder analytics sink; forward `ctx.tracking` to ClickHouse/Tinybird in a real adapter. */
export const minimalAnalyticsStrategy: Strategy = {
  id: 'example.analytics',
  stage: 'analytics',
  manifest: {
    id: 'example.analytics',
    stage: 'analytics',
    displayName: 'Minimal analytics adapter',
    defaultEnabled: false
  },
  async run(_ctx: StrategyPipelineContext): Promise<StrategyResult> {
    return { continuePipeline: true }
  }
}
