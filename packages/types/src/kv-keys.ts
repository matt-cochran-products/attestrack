/**
 * Canonical KV keys for Attestrack community deployments.
 * Premium extensions may add keys; these are the OSS contract surface.
 */

/** JSON document: {@link ConsentConfig} (Zod: `consentConfigSchema`). */
export const KV_KEY_CONSENT_CONFIG = 'attestrack:consent_config'

/** Plain-text body for `GET /privacy`. */
export const KV_KEY_POLICY_PRIVACY = 'attestrack:policy:privacy'

/** Plain-text body for `GET /terms`. */
export const KV_KEY_POLICY_TERMS = 'attestrack:policy:terms'

/** Operator portal: site configuration JSON. */
export const KV_KEY_PORTAL_SITE_CONFIG = 'attestrack:portal:site_config'

/** Operator portal: strategies list JSON. */
export const KV_KEY_PORTAL_STRATEGIES = 'attestrack:portal:strategies'

/** Operator portal: dashboard metrics JSON. */
export const KV_KEY_PORTAL_DASHBOARD = 'attestrack:portal:dashboard'

/** Operator portal: destinations JSON. */
export const KV_KEY_PORTAL_DESTINATIONS = 'attestrack:portal:destinations'

/** Operator portal: alert rules JSON. */
export const KV_KEY_PORTAL_ALERT_RULES = 'attestrack:portal:alert_rules'

/** Operator portal: request logs JSON array. */
export const KV_KEY_PORTAL_LOGS = 'attestrack:portal:logs'

/** Operator portal: signal recovery metrics JSON. */
export const KV_KEY_PORTAL_SIGNAL = 'attestrack:portal:signal'

/** Operator portal: curated analytics charts JSON. */
export const KV_KEY_PORTAL_ANALYTICS = 'attestrack:portal:analytics'

/** Operator portal: policy version lists JSON. */
export const KV_KEY_PORTAL_POLICY = 'attestrack:portal:policy'

/** Operator portal: banner config JSON. */
export const KV_KEY_PORTAL_BANNER = 'attestrack:portal:banner'

/** Operator portal: saved Explore queries JSON array (INV-B-17). */
export const KV_KEY_PORTAL_SAVED_QUERIES = 'attestrack:portal:saved_queries'

/** Drift: expected config fingerprint (set at deploy). */
export const KV_KEY_DRIFT_EXPECTED = 'attestrack:drift:expected_fingerprint'

/** Drift: last computed fingerprint. */
export const KV_KEY_DRIFT_CURRENT = 'attestrack:drift:current_fingerprint'

/** Drift: mismatch alert JSON `{ at, expected, current }` (written TTL'd by the drift-detection strategy). */
export const KV_KEY_DRIFT_MISMATCH = 'attestrack:drift:mismatch'

/** Observability: per-hour bounded request-log ring (`${prefix}YYYY-MM-DDTHH`, UTC, TTL'd). */
export const KV_KEY_OBS_LOG_PREFIX = 'attestrack:obs:log:'

/** Observability: per-UTC-day ingested-event counter (`${prefix}YYYY-MM-DD`, TTL'd). */
export const KV_KEY_OBS_EVENTS_PREFIX = 'attestrack:obs:events:'

/** Observability: per-strategy delivery stats JSON (`${prefix}${strategyId}`). */
export const KV_KEY_OBS_DELIVERY_PREFIX = 'attestrack:obs:delivery:'

/** Observability: per-UTC-day bot-filtered request counter (`${prefix}YYYY-MM-DD`, TTL'd). */
export const KV_KEY_OBS_BOTS_PREFIX = 'attestrack:obs:bots:'

/** Prefix for individual consent event records (`${prefix}${uuid}`). */
export const KV_KEY_CONSENT_EVENT_PREFIX = 'attestrack:consent_event:'

/** Enabled destination / analytics strategy ids (JSON string array). */
export const KV_KEY_ENABLED_STRATEGIES = 'attestrack:enabled_strategies'
