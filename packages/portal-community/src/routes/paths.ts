/** Canonical portal paths (Attestrack analytics-first; extensions handoff — ADR-010). */

export const paths = {
  root: '/',
  dashboard: '/dashboard',
  signal: '/signal',
  destinations: '/destinations',
  logs: '/logs',
  /** Consent, evidence, banner, policy, counsel: use extensions handoff. */
  extensions: '/extensions',
  strategies: '/strategies',
  configuration: '/configuration',
  analytics: '/analytics',
  explore: '/explore',
  migration: '/migration',
  upgrade: '/upgrade',
} as const;

export type PortalPath = (typeof paths)[keyof typeof paths];
