import { verifyPrivacyConsentToken, type Strategy } from '@attestrack/sdk'
import type { StrategyManifest, VerifiedPrivacyConsentToken } from '@attestrack/types'
import { communityJurisdictionStrategy } from './jurisdiction.js'
import { evidenceUnsignedStrategy } from './consent-log.js'
import { communityTrollShieldStrategy } from './troll-shield.js'

export const CONSENT_COOKIE_NAME = 'at_consent'

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null
  const parts = header.split(';')
  for (const p of parts) {
    const idx = p.indexOf('=')
    if (idx === -1) continue
    const k = p.slice(0, idx).trim()
    const v = p.slice(idx + 1).trim()
    if (k === name) return decodeURIComponent(v)
  }
  return null
}

function gpcActive(request: Request): boolean {
  return request.headers.get('Sec-GPC') === '1'
}

export async function verifyCommunityConsentToken(secret: string, token: string) {
  return verifyPrivacyConsentToken(secret, token)
}

function applyGpcOverride(v: VerifiedPrivacyConsentToken, honor: boolean): VerifiedPrivacyConsentToken {
  if (!honor || v.payload.decision !== 'granted') {
    return v
  }
  return {
    raw: v.raw,
    payload: {
      ...v.payload,
      decision: 'declined'
    }
  }
}

/**
 * Community consent gate: verify HMAC token from first-party cookie; honor GPC when configured.
 */
export const communityConsentStrategyManifest: StrategyManifest = {
  id: 'consent',
  stage: 'mandatory',
  displayName: 'Privacy consent gate (community)'
}

export function createConsentCookieStrategy(consentSecretEnvName: string): Strategy {
  return {
    id: 'consent',
    stage: 'mandatory',
    manifest: communityConsentStrategyManifest,
    async run(ctx) {
      const raw = readCookie(ctx.request.headers.get('cookie'), CONSENT_COOKIE_NAME)
      const secret = ctx.host.getSecret(consentSecretEnvName) ?? ''
      const gpc = gpcActive(ctx.request)
      const row = ctx.jurisdictionRow

      if (!raw || !secret) {
        return { continuePipeline: true, consent: null }
      }
      const v = await verifyPrivacyConsentToken(secret, raw)
      if (!v.ok) {
        return { continuePipeline: true, consent: null }
      }

      let consent: VerifiedPrivacyConsentToken | null = v
      if (gpc && row?.gpc_honor) {
        consent = applyGpcOverride(v, true)
      }

      return { continuePipeline: true, consent }
    }
  }
}

/**
 * Mandatory pipeline order: jurisdiction → consent cookie → consent log → troll shield.
 * Premium strategies may replace slots via loader + manifests without editing this list.
 */
export function defaultCommunityStrategies(consentSecretEnvName = 'CONSENT_TOKEN_SECRET') {
  return [
    communityJurisdictionStrategy,
    createConsentCookieStrategy(consentSecretEnvName),
    evidenceUnsignedStrategy,
    communityTrollShieldStrategy
  ]
}
