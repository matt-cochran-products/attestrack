import type { Strategy, StrategyPipelineContext, StrategyResult } from '@attestrack/sdk'
import type { StrategyStage } from '@attestrack/types'

function applyStrategyResult(ctx: StrategyPipelineContext, r: StrategyResult): void {
  if (r.tracking !== undefined) ctx.tracking = r.tracking
  if (r.consent !== undefined) ctx.consent = r.consent
}

/**
 * Mandatory stage: sequential order. `troll-shield` failures are isolated (Invariant: detection never blocks).
 */
export async function runMandatoryStrategies(
  ctx: StrategyPipelineContext,
  strategies: readonly Strategy[]
): Promise<void> {
  const ordered = strategies.filter((s) => s.stage === 'mandatory')
  for (const s of ordered) {
    if (s.id === 'troll-shield') {
      try {
        const r = await s.run(ctx)
        applyStrategyResult(ctx, r)
      } catch {
        /* isolated — do not block pipeline */
      }
      continue
    }
    const r = await s.run(ctx)
    applyStrategyResult(ctx, r)
    if (!r.continuePipeline) break
  }
}

/**
 * Destination stage: parallel execution with per-strategy error isolation.
 */
export async function runDestinationStrategiesParallel(
  ctx: StrategyPipelineContext,
  strategies: readonly Strategy[]
): Promise<void> {
  const dest = strategies.filter((s) => s.stage === 'destination')
  await Promise.all(
    dest.map(async (s) => {
      try {
        const r = await s.run(ctx)
        applyStrategyResult(ctx, r)
      } catch {
        /* isolate destination failures */
      }
    })
  )
}

export async function runStrategiesForStage(
  stage: StrategyStage,
  ctx: StrategyPipelineContext,
  strategies: readonly Strategy[]
): Promise<void> {
  const ordered = strategies.filter((s) => s.stage === stage)
  for (const s of ordered) {
    const r = await s.run(ctx)
    if (!r.continuePipeline) break
    applyStrategyResult(ctx, r)
  }
}
