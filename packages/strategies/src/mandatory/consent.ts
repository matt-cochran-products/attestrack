import {
  evaluateConsentGate,
  keyringFromSecretValues,
  verifyPrivacyConsentToken,
  type Strategy
} from '@attestrack/sdk'
import type { StrategyManifest, TrackingEventV1, VerifiedPrivacyConsentToken } from '@attestrack/types'
import { CONSENT_COOKIE_NAME } from '@attestrack/types'
import { communityJurisdictionStrategy } from './jurisdiction.js'
import { evidenceUnsignedStrategy } from './consent-log.js'
import { communityTrollShieldStrategy } from './troll-shield.js'

export { CONSENT_COOKIE_NAME }

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

/**
 * Mandatory consent strategy (P2.3):
 * 1. Verifies the `at_consent` cookie token (keyring incl. `<SECRET>_PREVIOUS`
 *    rotation, expiry, and — when the Worker provided `ctx.site.siteId` — site binding).
 * 2. Evaluates the consent gate from {site mode, jurisdiction-row mechanism,
 *    per-row GPC honoring, token decision} and publishes it as `ctx.consentGate`.
 * 3. Stamps decision + mode + mechanism + would-allow onto the tracking row so
 *    SHADOW-mode analytics report the would-be enforced rate honestly.
 */
export function createConsentCookieStrategy(consentSecretEnvName: string): Strategy {
  return {
    id: 'consent',
    stage: 'mandatory',
    manifest: communityConsentStrategyManifest,
    async run(ctx) {
      const raw = readCookie(ctx.request.headers.get('cookie'), CONSENT_COOKIE_NAME)
      const secret = ctx.host.getSecret(consentSecretEnvName)
      const gpc = gpcActive(ctx.request)
      const row = ctx.jurisdictionRow
      const mode = ctx.site?.mode ?? 'SHADOW'

      let verified: VerifiedPrivacyConsentToken | null = null
      if (raw && secret) {
        const keyring = keyringFromSecretValues(
          secret,
          ctx.host.getSecret(`${consentSecretEnvName}_PREVIOUS`)
        )
        const v = await verifyPrivacyConsentToken(keyring, raw, {
          ...(ctx.site?.siteId !== undefined ? { expectedSiteId: ctx.site.siteId } : {})
        })
        if (v.ok) verified = { payload: v.payload, raw: v.raw }
      }

      const gate = evaluateConsentGate({
        mode,
        row,
        tokenDecision: verified?.payload.decision ?? null,
        gpcSignal: gpc
      })
      ctx.consentGate = gate

      let consent: VerifiedPrivacyConsentToken | null = verified
      if (verified && gate.gpcApplied) {
        consent = applyGpcOverride(verified, true)
      }

      let tracking: TrackingEventV1 | undefined
      if (ctx.tracking) {
        tracking = {
          ...ctx.tracking,
          ...(gate.effectiveDecision !== null ? { consentDecision: gate.effectiveDecision } : {}),
          ...(ctx.jurisdictionKey !== undefined ? { jurisdiction: ctx.jurisdictionKey } : {}),
          consentMode: gate.mode,
          consentMechanism: gate.mechanism,
          consentWouldAllow: gate.wouldAllow
        }
      }

      return { continuePipeline: true, consent, ...(tracking ? { tracking } : {}) }
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
