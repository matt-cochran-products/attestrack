/**
 * Community-tier privacy consent token (HMAC envelope).
 * Independent Proof / record_id / anchors: licensed **Trust Chain Spec** (CETS v1.1); see root CONSENT-EVIDENCE-TOKEN-STANDARD.md pointer.
 */

export type ConsentDecision = 'granted' | 'declined' | 'withdrawn'

/** Payload carried inside the signed community consent token (version 1). */
export interface PrivacyConsentTokenPayloadV1 {
  v: 1
  siteId: string
  decision: ConsentDecision
  /** ISO 8601 timestamp when the token was minted */
  issuedAt: string
  /**
   * ISO 8601 expiry (derived from site config `state1TokenTTL` at mint time).
   * Tokens without `expiresAt` never expire — mint with a TTL in production.
   */
  expiresAt?: string
  policyHash: string
  jurisdictionHint?: string
  /**
   * Ids of the IOA assertions ({@link IoaAssertion}) the visitor affirmatively accepted.
   * Absent/empty when no checkbox flow was completed — consumers must treat that as "not attested".
   */
  ioa?: readonly string[]
}

export interface VerifiedPrivacyConsentToken {
  payload: PrivacyConsentTokenPayloadV1
  /** Full serialized token (two base64url segments). */
  raw: string
}
