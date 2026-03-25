import type { Strategy, StrategyPipelineContext, StrategyResult } from '@attestrue/sdk'
import type { StrategyManifest } from '@attestrue/types'

/**
 * **EvidenceUnsignedStrategy**: writes a flat `ConsentEventRecordV1` (self-attested).
 * Not a placeholder for Merkle/Proof — those remain out of the public core per v9.2.
 */
export const evidenceUnsignedStrategyManifest: StrategyManifest = {
  id: 'evidence-unsigned',
  stage: 'mandatory',
  displayName: 'Consent event log (unsigned operational record)'
}

export const evidenceUnsignedStrategy: Strategy = {
  id: 'evidence-unsigned',
  stage: 'mandatory',
  manifest: evidenceUnsignedStrategyManifest,
  async run(_ctx: StrategyPipelineContext): Promise<StrategyResult> {
    return { continuePipeline: true }
  }
}
