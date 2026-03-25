/**
 * Community-tier privacy consent token (HMAC envelope).
 * Independent Proof / record_id / anchors are specified in CONSENT-EVIDENCE-TOKEN-STANDARD (v9.2, no Merkle).
 */

export type ConsentDecision = 'granted' | 'declined' | 'withdrawn'

/** Payload carried inside the signed community consent token (version 1). */
export interface PrivacyConsentTokenPayloadV1 {
  v: 1
  siteId: string
  decision: ConsentDecision
  /** ISO 8601 timestamp when the token was minted */
  issuedAt: string
  policyHash: string
  jurisdictionHint?: string
}

export interface VerifiedPrivacyConsentToken {
  payload: PrivacyConsentTokenPayloadV1
  /** Full serialized token (two base64url segments). */
  raw: string
}
