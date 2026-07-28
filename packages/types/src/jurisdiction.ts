/**
 * Community-tier consent configuration stored in operator KV (e.g. Cloudflare KV).
 * The paid Privacy Consent add-on writes the same document shape on the customer's behalf;
 * only the source of truth and maintenance cadence change.
 *
 * This is a functional data contract, not legal advice. Operators remain responsible
 * for configuration accuracy unless they use attorney-maintained services.
 */

import type { RegulationFrameworkId } from './regulation.js'

/** Row keyed by jurisdiction label (e.g. `US-CA`, `EU`) plus a `DEFAULT` fallback row. */
export type ConsentJurisdictionKey = string

/**
 * ISO 3166-2 style subdivisions for US states and DC (`US-AL` … `US-WY`, `US-DC`).
 * Territories (e.g. `US-PR`, `US-GU`) and custom region keys are still valid
 * {@link ConsentJurisdictionKey} values in KV — this list is for validation/UI hints, not an exhaustive allowlist.
 */
export const US_STATE_AND_DC_ISO_CODES = [
  'US-AL',
  'US-AK',
  'US-AZ',
  'US-AR',
  'US-CA',
  'US-CO',
  'US-CT',
  'US-DE',
  'US-FL',
  'US-GA',
  'US-HI',
  'US-ID',
  'US-IL',
  'US-IN',
  'US-IA',
  'US-KS',
  'US-KY',
  'US-LA',
  'US-ME',
  'US-MD',
  'US-MA',
  'US-MI',
  'US-MN',
  'US-MS',
  'US-MO',
  'US-MT',
  'US-NE',
  'US-NV',
  'US-NH',
  'US-NJ',
  'US-NM',
  'US-NY',
  'US-NC',
  'US-ND',
  'US-OH',
  'US-OK',
  'US-OR',
  'US-PA',
  'US-RI',
  'US-SC',
  'US-SD',
  'US-TN',
  'US-TX',
  'US-UT',
  'US-VT',
  'US-VA',
  'US-WA',
  'US-WV',
  'US-WI',
  'US-WY',
  'US-DC'
] as const

export type UsStateOrDcIsoCode = (typeof US_STATE_AND_DC_ISO_CODES)[number]

export function isUsStateOrDcIsoCode(key: string): key is UsStateOrDcIsoCode {
  return (US_STATE_AND_DC_ISO_CODES as readonly string[]).includes(key)
}

export type ConsentMechanism = 'opt-in' | 'opt-out'

export type ConsentProfile = 'standard' | 'elevated'

/**
 * One attestation the visitor must accept (single line or one checkbox).
 * Multi-checkbox flows use multiple items with distinct `id`s.
 */
export interface IoaAssertion {
  /** Stable id stored with consent events (e.g. `privacy_policy`, `terms`, `marketing`). */
  id: string
  /** Copy shown next to the checkbox or in scroll-wrap summary. */
  text: string
  /** When true (default), must be affirmatively accepted when mechanism requires it. */
  required?: boolean
}

export interface JurisdictionConsentRow {
  profile: ConsentProfile
  mechanism: ConsentMechanism
  /**
   * One or more IOA lines / checkboxes. Single element = legacy single-ack flow.
   */
  ioa_assertions: readonly IoaAssertion[]
  /** Logical document keys (e.g. `privacy_policy`, `terms`) resolved by the host. */
  documents: readonly string[]
  gpc_honor: boolean
  /**
   * Optional labels for which regulatory frameworks this row is intended to satisfy (portal / matrix).
   */
  applies_regulations?: readonly RegulationFrameworkId[]
}

export interface ConsentConfig {
  jurisdictions: Readonly<Record<ConsentJurisdictionKey, JurisdictionConsentRow>>
}

function row(
  profile: ConsentProfile,
  mechanism: ConsentMechanism,
  text: string,
  documents: readonly string[],
  gpc_honor: boolean,
  applies?: readonly RegulationFrameworkId[]
): JurisdictionConsentRow {
  return {
    profile,
    mechanism,
    ioa_assertions: [{ id: 'primary', text, required: true }],
    documents,
    gpc_honor,
    ...(applies?.length ? { applies_regulations: applies } : {})
  }
}

/**
 * Sensible starting defaults for common deployments. Not attorney-maintained;
 * copy or adapt into KV. For case-law-current rows and auto-updates after rulings,
 * use the Privacy Consent add-on (see repo docs).
 *
 * Only a few rows are prefilled; add per-state keys (see {@link US_STATE_AND_DC_ISO_CODES}) as needed.
 */
/** EU member states (ISO 3166-1 alpha-2) for coarse `EU` row resolution. */
export const EU_MEMBER_STATE_CODES = [
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE'
] as const

const EU_MEMBER_STATE_SET: ReadonlySet<string> = new Set(EU_MEMBER_STATE_CODES)

/**
 * Resolve the active jurisdiction key from a geo signal (ISO 3166-1 alpha-2)
 * against a {@link ConsentConfig}: exact country row → coarse `EU` row → `DEFAULT`.
 * Shared by the community jurisdiction strategy and the Worker consent-context route.
 */
export function resolveJurisdictionKey(geo: string | null, config: ConsentConfig): ConsentJurisdictionKey {
  if (!geo) return 'DEFAULT'
  const cc = geo.toUpperCase()
  if (config.jurisdictions[cc]) return cc
  if (EU_MEMBER_STATE_SET.has(cc) && config.jurisdictions.EU) return 'EU'
  return 'DEFAULT'
}

export const COMMUNITY_DEFAULT_CONSENT_CONFIG: ConsentConfig = {
  jurisdictions: {
    'US-CA': row(
      'elevated',
      'opt-in',
      'I have had the opportunity to review the Privacy Policy and I agree.',
      ['privacy_policy', 'terms'],
      true,
      ['us_ca_cpra']
    ),
    EU: row(
      'standard',
      'opt-in',
      'I consent to the use of cookies and tracking technologies.',
      ['privacy_policy', 'cookie_notice'],
      true,
      ['gdpr', 'eea']
    ),
    DEFAULT: row(
      'standard',
      'opt-out',
      'By continuing to use this site you agree to our Privacy Policy.',
      ['privacy_policy'],
      true
    )
  }
}
