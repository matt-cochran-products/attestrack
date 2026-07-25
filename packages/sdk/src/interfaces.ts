import type { HostRuntime } from '@attestrack/host-contracts'
import type {
  JurisdictionConsentRow,
  TrackingEventV1,
  StrategyManifest,
  StrategyStage,
  VerifiedPrivacyConsentToken
} from '@attestrack/types'

/** Mutable pipeline context passed through mandatory and destination stages. */
export interface StrategyPipelineContext {
  host: HostRuntime
  request: Request
  tracking?: TrackingEventV1
  consent?: VerifiedPrivacyConsentToken | null
  /** Set by jurisdiction strategy from `ConsentConfig` + geo signals. */
  jurisdictionKey?: string
  jurisdictionRow?: JurisdictionConsentRow
}

export interface StrategyResult {
  continuePipeline: boolean
  tracking?: TrackingEventV1
  consent?: VerifiedPrivacyConsentToken | null
}

export interface Strategy {
  readonly id: string
  readonly stage: StrategyStage
  /**
   * When set (bundled or CDN-loaded), `manifest.replaces` participates in Stage-1 resolution:
   * extension strategies remove bundled strategies with matching ids before the pipeline runs.
   */
  readonly manifest?: StrategyManifest
  run(ctx: StrategyPipelineContext): Promise<StrategyResult>
}

/** Loads additional signed strategies at runtime (premium CDN, marketplace). */
export interface StrategyLoader {
  loadForRequest(request: Request): Promise<readonly Strategy[]>
}

export const noopStrategyLoader: StrategyLoader = {
  async loadForRequest() {
    return []
  }
}
