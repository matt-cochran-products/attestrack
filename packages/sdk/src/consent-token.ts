import type { PrivacyConsentTokenPayloadV1 } from '@attestrack/types'
import { privacyConsentTokenPayloadV1Schema } from '@attestrack/schema'

const te = new TextEncoder()

/** Token key ids are versioned: `k1`, `k2`, … (rotation without invalidating old tokens). */
const KEY_ID_PATTERN = /^k\d+$/u

/** Default key id used when a plain string secret is supplied. */
export const DEFAULT_CONSENT_KEY_ID = 'k1'

/**
 * Named signing keys for consent tokens. `currentKeyId` signs new tokens;
 * every entry in `keys` remains valid for verification (rotation window).
 */
export interface ConsentTokenKeyring {
  keys: Readonly<Record<string, string>>
  currentKeyId: string
}

/** Either a single secret (treated as key id `k1`) or an explicit keyring. */
export type ConsentSigningSecret = string | ConsentTokenKeyring

/**
 * Parse an operator-provided secret value of the form `k2.<secret>` into
 * `{ keyId, secret }`. Plain values (no `k<N>.` prefix) map to key id `k1`.
 */
export function parseConsentSecretValue(value: string): { keyId: string; secret: string } {
  const m = /^(k\d+)\.(.+)$/su.exec(value)
  if (m) return { keyId: m[1]!, secret: m[2]! }
  return { keyId: DEFAULT_CONSENT_KEY_ID, secret: value }
}

/**
 * Build a keyring from the current secret value plus optional previous values
 * (e.g. Worker secrets `CONSENT_TOKEN_SECRET` and `CONSENT_TOKEN_SECRET_PREVIOUS`).
 * Each value may carry a `k<N>.` prefix; the current value's key id signs new tokens.
 */
export function keyringFromSecretValues(
  current: string,
  ...previous: (string | undefined)[]
): ConsentTokenKeyring {
  const cur = parseConsentSecretValue(current)
  const keys: Record<string, string> = { [cur.keyId]: cur.secret }
  for (const p of previous) {
    if (!p) continue
    const parsed = parseConsentSecretValue(p)
    if (!(parsed.keyId in keys)) keys[parsed.keyId] = parsed.secret
  }
  return { keys, currentKeyId: cur.keyId }
}

function normalizeKeyring(secret: ConsentSigningSecret): ConsentTokenKeyring {
  if (typeof secret === 'string') {
    return { keys: { [DEFAULT_CONSENT_KEY_ID]: secret }, currentKeyId: DEFAULT_CONSENT_KEY_ID }
  }
  return secret
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
}

function base64UrlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    te.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, te.encode(message))
  return new Uint8Array(sig)
}

/** Sorted-key JSON for stable signing bytes. */
export function stableConsentPayloadJson(payload: PrivacyConsentTokenPayloadV1): string {
  const keys = Object.keys(payload).sort() as (keyof PrivacyConsentTokenPayloadV1)[]
  const sorted: Record<string, unknown> = {}
  for (const k of keys) sorted[k as string] = payload[k]
  return JSON.stringify(sorted)
}

export interface CreateConsentTokenOptions {
  /** Token lifetime in seconds (e.g. site config `state1TokenTTL`); sets `expiresAt`. */
  ttlSeconds?: number
  /** Clock override for tests. */
  now?: Date
}

/**
 * Mint a community consent token: `k<N>.<payload-b64url>.<sig-b64url>`.
 * The HMAC covers `k<N>.<payload-b64url>` so the key id is tamper-bound.
 */
export async function createPrivacyConsentToken(
  secret: ConsentSigningSecret,
  input: Omit<PrivacyConsentTokenPayloadV1, 'v' | 'issuedAt'> & { issuedAt?: string },
  options: CreateConsentTokenOptions = {}
): Promise<string> {
  const keyring = normalizeKeyring(secret)
  const keyId = keyring.currentKeyId
  if (!KEY_ID_PATTERN.test(keyId)) throw new Error(`invalid consent key id: ${keyId}`)
  const signingSecret = keyring.keys[keyId]
  if (!signingSecret) throw new Error(`consent keyring missing current key: ${keyId}`)

  const now = options.now ?? new Date()
  const issuedAt = input.issuedAt ?? now.toISOString()
  const expiresAt =
    input.expiresAt ??
    (options.ttlSeconds != null
      ? new Date(now.getTime() + options.ttlSeconds * 1000).toISOString()
      : undefined)
  const payload = privacyConsentTokenPayloadV1Schema.parse({
    v: 1 as const,
    siteId: input.siteId,
    decision: input.decision,
    issuedAt,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    policyHash: input.policyHash,
    ...(input.jurisdictionHint !== undefined ? { jurisdictionHint: input.jurisdictionHint } : {}),
    ...(input.ioa !== undefined ? { ioa: input.ioa } : {})
  })
  const body = stableConsentPayloadJson(payload)
  const payloadPart = bytesToBase64Url(te.encode(body))
  const sig = await hmacSha256(signingSecret, `${keyId}.${payloadPart}`)
  return `${keyId}.${payloadPart}.${bytesToBase64Url(sig)}`
}

export interface VerifyConsentTokenOptions {
  /** When set, tokens minted for a different `siteId` are rejected (`wrong_site`). */
  expectedSiteId?: string
  /** Clock override for tests. */
  now?: Date
}

/**
 * Verify a community consent token. Checks, in order: shape, known key id,
 * HMAC (timing-safe), payload encoding/schema, canonical JSON, expiry, site binding.
 */
export async function verifyPrivacyConsentToken(
  secret: ConsentSigningSecret,
  token: string,
  options: VerifyConsentTokenOptions = {}
): Promise<
  { ok: true; payload: PrivacyConsentTokenPayloadV1; raw: string; keyId: string } | { ok: false; reason: string }
> {
  const keyring = normalizeKeyring(secret)
  const parts = token.split('.')
  if (parts.length !== 3) return { ok: false, reason: 'malformed' }
  const [keyId, payloadPart, sigPart] = parts as [string, string, string]
  if (!KEY_ID_PATTERN.test(keyId) || payloadPart.length === 0 || sigPart.length === 0) {
    return { ok: false, reason: 'malformed' }
  }
  const verifySecret = keyring.keys[keyId]
  if (!verifySecret) return { ok: false, reason: 'unknown_key' }

  let expectedSig: Uint8Array
  try {
    expectedSig = await hmacSha256(verifySecret, `${keyId}.${payloadPart}`)
  } catch {
    return { ok: false, reason: 'crypto_error' }
  }
  let providedSig: Uint8Array
  try {
    providedSig = base64UrlToBytes(sigPart)
  } catch {
    return { ok: false, reason: 'bad_encoding' }
  }
  if (!timingSafeEqualBytes(expectedSig, providedSig)) return { ok: false, reason: 'bad_signature' }

  let json: string
  try {
    json = new TextDecoder().decode(base64UrlToBytes(payloadPart))
  } catch {
    return { ok: false, reason: 'bad_payload_encoding' }
  }

  let data: unknown
  try {
    data = JSON.parse(json) as unknown
  } catch {
    return { ok: false, reason: 'invalid_json' }
  }

  const parsed = privacyConsentTokenPayloadV1Schema.safeParse(data)
  if (!parsed.success) return { ok: false, reason: 'invalid_payload' }

  if (stableConsentPayloadJson(parsed.data) !== json) return { ok: false, reason: 'non_canonical' }

  if (parsed.data.expiresAt !== undefined) {
    const now = options.now ?? new Date()
    const exp = Date.parse(parsed.data.expiresAt)
    if (!Number.isFinite(exp) || now.getTime() >= exp) return { ok: false, reason: 'expired' }
  }

  if (options.expectedSiteId !== undefined && parsed.data.siteId !== options.expectedSiteId) {
    return { ok: false, reason: 'wrong_site' }
  }

  return { ok: true, payload: parsed.data, raw: token, keyId }
}
