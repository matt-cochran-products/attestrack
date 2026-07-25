import type { PrivacyConsentTokenPayloadV1 } from '@attestrack/types'
import { privacyConsentTokenPayloadV1Schema } from '@attestrack/schema'

const te = new TextEncoder()

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

async function hmacSha256B64UrlPayload(secret: string, payloadB64Url: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    te.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, te.encode(payloadB64Url))
  return new Uint8Array(sig)
}

/** Sorted-key JSON for stable signing bytes. */
export function stableConsentPayloadJson(payload: PrivacyConsentTokenPayloadV1): string {
  const keys = Object.keys(payload).sort() as (keyof PrivacyConsentTokenPayloadV1)[]
  const sorted: Record<string, unknown> = {}
  for (const k of keys) sorted[k as string] = payload[k]
  return JSON.stringify(sorted)
}

export async function createPrivacyConsentToken(
  secret: string,
  input: Omit<PrivacyConsentTokenPayloadV1, 'v' | 'issuedAt'> & { issuedAt?: string }
): Promise<string> {
  const issuedAt = input.issuedAt ?? new Date().toISOString()
  const payload = privacyConsentTokenPayloadV1Schema.parse({
    v: 1 as const,
    siteId: input.siteId,
    decision: input.decision,
    issuedAt,
    policyHash: input.policyHash,
    jurisdictionHint: input.jurisdictionHint
  })
  const body = stableConsentPayloadJson(payload)
  const payloadPart = bytesToBase64Url(te.encode(body))
  const sig = await hmacSha256B64UrlPayload(secret, payloadPart)
  return `${payloadPart}.${bytesToBase64Url(sig)}`
}

export async function verifyPrivacyConsentToken(
  secret: string,
  token: string
): Promise<
  { ok: true; payload: PrivacyConsentTokenPayloadV1; raw: string } | { ok: false; reason: string }
> {
  const dot = token.indexOf('.')
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: 'malformed' }
  const payloadPart = token.slice(0, dot)
  const sigPart = token.slice(dot + 1)
  let expectedSig: Uint8Array
  try {
    expectedSig = await hmacSha256B64UrlPayload(secret, payloadPart)
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

  return { ok: true, payload: parsed.data, raw: token }
}
