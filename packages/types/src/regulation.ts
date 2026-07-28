/**
 * Regulation / statutory framework identifiers for labeling, portal UX, and premium regulation packs.
 * These are **technical slugs**, not legal determinations — counsel maps geography and facts to frameworks.
 */

/** Arbitrary slug; prefer values from {@link COMMON_REGULATION_FRAMEWORK_IDS} when possible. */
export type RegulationFrameworkId = string

/**
 * Commonly referenced frameworks in US + EU deployments. Extend over time; unknown slugs remain valid
 * on {@link RegulationFrameworkId} for operator-specific or future laws.
 */
export const COMMON_REGULATION_FRAMEWORK_IDS = [
  'gdpr',
  'eea',
  'uk_gdpr',
  'ch_gdpr', // Switzerland FADP alignment often grouped with GDPR-style UX
  'us_ca_cpra',
  'us_va_vcdpa',
  'us_co_cpa',
  'us_ct_ctdpa',
  'us_ut_ucpa',
  'us_in_icdpa',
  'us_tx_tdpsa',
  'us_or_ocpa',
  'us_nh_nhcpa',
  'us_nj_njpa',
  'us_de_dedpa',
  'us_mn_mncdpa',
  'us_md_mcdpa',
  'us_ne_nebraska_privacy',
  'us_tn_tipa',
  'us_ia_icda',
  'us_mt_mcdpa'
] as const

export type CommonRegulationFrameworkId = (typeof COMMON_REGULATION_FRAMEWORK_IDS)[number]
