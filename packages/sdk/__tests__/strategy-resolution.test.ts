import { describe, expect, it } from 'vitest'
import type { Strategy, StrategyPipelineContext, StrategyResult } from '../src/interfaces.js'
import { resolveStrategiesWithReplaces } from '../src/strategy-resolution.js'
import type { StrategyManifest } from '@attestrack/types'

async function noopRun(_ctx: StrategyPipelineContext): Promise<StrategyResult> {
  return { continuePipeline: true }
}

function strat(id: string, manifest?: StrategyManifest): Strategy {
  return { id, stage: 'mandatory', manifest, run: noopRun }
}

describe('resolveStrategiesWithReplaces', () => {
  it('drops bundled ids listed in extension manifest.replaces', () => {
    const bundled = [strat('jurisdiction'), strat('consent'), strat('troll-shield')]
    const premiumManifest: StrategyManifest = {
      id: 'jurisdiction-complete',
      stage: 'mandatory',
      displayName: 'Jurisdiction (premium)',
      replaces: ['jurisdiction']
    }
    const extensions = [strat('jurisdiction-complete', premiumManifest)]
    const out = resolveStrategiesWithReplaces(bundled, extensions)
    expect(out.map((s) => s.id)).toEqual(['consent', 'troll-shield', 'jurisdiction-complete'])
  })

  it('is a no-op when extensions omit replaces', () => {
    const bundled = [strat('a'), strat('b')]
    const extensions = [strat('c')]
    expect(resolveStrategiesWithReplaces(bundled, extensions).map((s) => s.id)).toEqual([
      'a',
      'b',
      'c'
    ])
  })
})
