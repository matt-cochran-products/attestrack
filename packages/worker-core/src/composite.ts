import type { Strategy, StrategyPipelineContext } from '@attestrue/sdk'
import type { StrategyStage } from '@attestrue/types'

export async function runStrategiesForStage(
  stage: StrategyStage,
  ctx: StrategyPipelineContext,
  strategies: readonly Strategy[]
): Promise<void> {
  const ordered = strategies.filter((s) => s.stage === stage)
  for (const s of ordered) {
    const r = await s.run(ctx)
    if (!r.continuePipeline) break
    if (r.tracking !== undefined) ctx.tracking = r.tracking
    if (r.consent !== undefined) ctx.consent = r.consent
  }
}
