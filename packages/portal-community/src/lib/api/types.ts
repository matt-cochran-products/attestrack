/** DTOs for portal API responses (stubs + Worker contract target). */

export type DestinationHealthStatus = 'healthy' | 'degraded' | 'inactive' | 'no_data';

export interface DestinationRow {
  id: string;
  name: string;
  status: DestinationHealthStatus;
  successRate: number;
  lastEvent: string | null;
  auth: string;
  eventsToday: number;
}

export interface AlertRule {
  destination: string;
  condition: string;
  email: string;
  active: boolean;
}

export interface RequestLogRow {
  timestamp: string;
  event: string;
  source: string;
  jurisdiction: string;
  consent: string;
  processingTime: number;
  status: string;
}

/**
 * P3.3 decision: signal-recovery comparisons are NOT measured in v1 (they
 * require a client beacon Attestrack does not ship yet). The Worker reports
 * `measured: false` + `reason: 'requires_beacon'`; the only real number is
 * the troll-shield bot-filter counter.
 */
export interface SignalRecoveryMetrics {
  measured: boolean;
  reason?: string;
  message?: string;
  botRequestsFiltered: number;
}

export interface StrategyRow {
  id: string;
  name: string;
  status: 'active' | 'degraded' | 'inactive';
  eventsToday: number | null;
}

export interface ProofLayerStrategyRow {
  id: string;
  name: string;
  locked: boolean;
  description: string;
}

export interface StrategiesResponse {
  builtin: StrategyRow[];
  proofLayer: ProofLayerStrategyRow[];
}

export type SiteMode = 'SHADOW' | 'ENFORCEMENT' | 'NOT_CONFIGURED';

export interface SiteConfig {
  siteId: string;
  domain: string;
  workerVersion: string;
  shadowStart: string;
  enforcementStart: string | null;
  mode: SiteMode;
  consentConfigured: boolean;
  state1TokenTTL: number;
  ipHandling: string;
  trustedDomains: string[];
  driftDetection: {
    enabled: boolean;
    quarantineNew: boolean;
    alertThreshold: number;
  };
}

export interface BannerConfigState {
  configured: boolean;
  status: string;
  jurisdictions: unknown[];
}

export interface PolicyVersionLists {
  privacyPolicy: unknown[];
  termsOfUse: unknown[];
}

/** Drift mismatch detail recorded by the Worker's drift-detection strategy (P3.5). */
export interface DriftAlertDetail {
  at: string;
  expected: string;
  current: string;
}

export interface DashboardMetrics {
  eventsToday: number;
  driftAlertCount: number;
  /** Present when a config-drift mismatch is currently recorded (P3.5). */
  driftAlert?: DriftAlertDetail | null;
  strategyStatus: 'all_healthy' | 'degraded' | 'inactive';
  strategySummary: string;
  shadowModeLabel: string;
}

export interface ExploreQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
}

export interface SavedQueryEntry {
  id: string;
  name: string;
  sql: string;
  updatedAt: string;
}
