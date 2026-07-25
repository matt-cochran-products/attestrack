import type { HostRuntime } from '@attestrack/host-contracts'
import {
  consentCommitRequestSchema,
  parseConsentConfigJson,
  trackingEventV1Schema
} from '@attestrack/schema'
import {
  createPrivacyConsentToken,
  keyringFromSecretValues,
  resolveStrategiesWithReplaces,
  type Strategy,
  type StrategyLoader,
  type StrategyPipelineContext
} from '@attestrack/sdk'
import {
  COMMUNITY_DEFAULT_CONSENT_CONFIG,
  CONSENT_COOKIE_NAME,
  KV_KEY_CONSENT_CONFIG,
  KV_KEY_ENABLED_STRATEGIES,
  KV_KEY_POLICY_PRIVACY,
  KV_KEY_POLICY_TERMS,
  resolveJurisdictionKey,
  type ConsentConfig,
  type PipelineSiteInfo
} from '@attestrack/types'
import {
  runDestinationStrategiesParallel,
  runMandatoryStrategies,
  runStrategiesForStage
} from './composite.js'
import { effectiveSiteMode, readSiteConfig, type SiteConfigKv } from './config.js'
import { preflightResponse, resolveCorsOrigin, withCors } from './cors.js'
import { filterStrategiesByEnabledKv, parseEnabledStrategiesKv } from './enabled-strategies.js'
import { CONSENT_JS_HASH, CONSENT_JS_SOURCE } from './consent-bundle.generated.js'
import { TRACKING_EVENT_PATH } from './constants.js'
import { recordIngestObservability } from './observability.js'
import { handlePortalRequest } from './portal.js'

const DEFAULT_PRIVACY = 'Privacy policy not configured. Set KV key attestrack:policy:privacy.\n'
const DEFAULT_TERMS = 'Terms of use not configured. Set KV key attestrack:policy:terms.\n'

export interface AttestrackWorkerOptions {
  host: HostRuntime
  consentSecretName: string
  bundledStrategies: readonly Strategy[]
  strategyLoader: StrategyLoader
}

/** Site config snapshot for the pipeline — resolved ONCE per request (P2.3). */
function pipelineSiteInfo(config: SiteConfigKv): PipelineSiteInfo {
  return {
    mode: effectiveSiteMode(config),
    siteId: config.siteId,
    domain: config.domain,
    ...(config.consentEventTtlSeconds !== undefined
      ? { consentEventTtlSeconds: config.consentEventTtlSeconds }
      : {})
  }
}

async function runPipeline(
  options: AttestrackWorkerOptions,
  request: Request,
  site: PipelineSiteInfo,
  seed: Pick<StrategyPipelineContext, 'tracking' | 'consent'> = {}
): Promise<StrategyPipelineContext> {
  const extensions = await options.strategyLoader.loadForRequest(request)
  const merged = resolveStrategiesWithReplaces(options.bundledStrategies, extensions)
  const rawEnabled = await options.host.kv.get(KV_KEY_ENABLED_STRATEGIES)
  const enabledIds = parseEnabledStrategiesKv(rawEnabled)
  const effectiveStrategies = filterStrategiesByEnabledKv(merged, enabledIds)
  const ctx: StrategyPipelineContext = {
    host: options.host,
    request,
    site,
    ...seed
  }
  await runMandatoryStrategies(ctx, effectiveStrategies)
  await runDestinationStrategiesParallel(ctx, effectiveStrategies)
  await runStrategiesForStage('analytics', ctx, effectiveStrategies)
  return ctx
}

/**
 * Build the `Set-Cookie` value for the consent token (P2.1 cookie topology).
 * `Domain` comes from site config (`cookieDomain` ?? `domain`) so the cookie
 * reaches the tracking subdomain worker; it is only emitted when the worker's
 * own host is inside that domain (otherwise browsers reject the cookie —
 * fall back to a host-only cookie).
 */
export function buildConsentCookie(
  token: string,
  config: Pick<SiteConfigKv, 'domain' | 'cookieDomain' | 'state1TokenTTL'>,
  requestHostname: string
): string {
  const domain = config.cookieDomain ?? config.domain
  const domainApplies =
    domain.length > 0 && (requestHostname === domain || requestHostname.endsWith(`.${domain}`))
  const attrs = [
    `${CONSENT_COOKIE_NAME}=${encodeURIComponent(token)}`,
    ...(domainApplies ? [`Domain=${domain}`] : []),
    'Path=/',
    `Max-Age=${config.state1TokenTTL}`,
    'Secure',
    'SameSite=Lax'
  ]
  return attrs.join('; ')
}

const CONSENT_JS_PATH = '/consent.js'
const CONSENT_COMMIT_PATH = '/__attestrack__/consent/commit'
const CONSENT_CONTEXT_PATH = '/__attestrack__/consent/context'

/** Known policy document keys → Worker routes (row.documents refs resolve here). */
const POLICY_REFS: Readonly<Record<string, string>> = {
  privacy_policy: '/privacy',
  terms: '/terms',
  cookie_notice: '/privacy'
}

export function createAttestrackFetchHandler(options: AttestrackWorkerOptions) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const siteConfig = await readSiteConfig(options.host)
    const corsOrigin = resolveCorsOrigin(request, siteConfig)

    if (
      request.method === 'OPTIONS' &&
      (url.pathname === CONSENT_COMMIT_PATH ||
        url.pathname === TRACKING_EVENT_PATH ||
        url.pathname === CONSENT_CONTEXT_PATH)
    ) {
      return preflightResponse(request, siteConfig, 'GET, POST, OPTIONS')
    }

    const portalRes = await handlePortalRequest(request, options.host)
    if (portalRes) return portalRes

    if (request.method === 'POST' && url.pathname === CONSENT_COMMIT_PATH) {
      const secret = options.host.getSecret(options.consentSecretName)
      if (!secret) {
        return withCors(
          Response.json({ error: 'consent_secret_not_configured' }, { status: 503 }),
          corsOrigin
        )
      }
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return withCors(Response.json({ error: 'invalid_json' }, { status: 400 }), corsOrigin)
      }
      const parsed = consentCommitRequestSchema.safeParse(body)
      if (!parsed.success) {
        return withCors(
          Response.json({ error: 'invalid_body', details: parsed.error.flatten() }, { status: 400 }),
          corsOrigin
        )
      }
      const keyring = keyringFromSecretValues(
        secret,
        options.host.getSecret(`${options.consentSecretName}_PREVIOUS`)
      )
      const token = await createPrivacyConsentToken(
        keyring,
        {
          siteId: parsed.data.siteId,
          decision: parsed.data.decision,
          policyHash: parsed.data.policyHash,
          ...(parsed.data.jurisdictionHint !== undefined
            ? { jurisdictionHint: parsed.data.jurisdictionHint }
            : {}),
          ...(parsed.data.ioaAccepted !== undefined ? { ioa: parsed.data.ioaAccepted } : {})
        },
        { ttlSeconds: siteConfig.state1TokenTTL }
      )
      const res = Response.json(
        { token },
        {
          headers: {
            'cache-control': 'no-store',
            'set-cookie': buildConsentCookie(token, siteConfig, url.hostname)
          }
        }
      )
      return withCors(res, corsOrigin)
    }

    if (request.method === 'GET' && url.pathname === CONSENT_CONTEXT_PATH) {
      const rawConfig = await options.host.kv.get(KV_KEY_CONSENT_CONFIG)
      const consentConfig = parseConsentConfigJson<ConsentConfig>(
        rawConfig,
        COMMUNITY_DEFAULT_CONSENT_CONFIG
      )
      const jurisdictionKey = resolveJurisdictionKey(
        options.host.geoCountry(request),
        consentConfig
      )
      const row =
        consentConfig.jurisdictions[jurisdictionKey] ??
        consentConfig.jurisdictions.DEFAULT ??
        COMMUNITY_DEFAULT_CONSENT_CONFIG.jurisdictions.DEFAULT!
      const policyRefs: Record<string, string> = {}
      for (const doc of row.documents) {
        const ref = POLICY_REFS[doc]
        if (ref) policyRefs[doc] = ref
      }
      const res = Response.json(
        {
          siteId: siteConfig.siteId,
          mode: effectiveSiteMode(siteConfig),
          jurisdictionKey,
          row,
          policyRefs
        },
        { headers: { 'cache-control': 'no-store' } }
      )
      return withCors(res, corsOrigin)
    }

    if (request.method === 'GET' && url.pathname === CONSENT_JS_PATH) {
      const etag = `"${CONSENT_JS_HASH}"`
      const cache = 'public, max-age=3600, stale-while-revalidate=86400'
      if (request.headers.get('if-none-match') === etag) {
        return new Response(null, { status: 304, headers: { etag, 'cache-control': cache } })
      }
      return new Response(CONSENT_JS_SOURCE, {
        status: 200,
        headers: {
          'content-type': 'text/javascript; charset=utf-8',
          etag,
          'cache-control': cache,
          // Static public script: safe for any origin, no credentials involved.
          'access-control-allow-origin': '*'
        }
      })
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return new Response('ok', { status: 200 })
    }

    if (request.method === 'GET' && url.pathname === '/privacy') {
      const text = (await options.host.kv.get(KV_KEY_POLICY_PRIVACY)) ?? DEFAULT_PRIVACY
      return new Response(text, {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
      })
    }

    if (request.method === 'GET' && url.pathname === '/terms') {
      const text = (await options.host.kv.get(KV_KEY_POLICY_TERMS)) ?? DEFAULT_TERMS
      return new Response(text, {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
      })
    }

    if (request.method === 'POST' && url.pathname === TRACKING_EVENT_PATH) {
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return withCors(Response.json({ error: 'invalid_json' }, { status: 400 }), corsOrigin)
      }
      const parsed = trackingEventV1Schema.safeParse(body)
      if (!parsed.success) {
        return withCors(
          Response.json({ error: 'invalid_body', details: parsed.error.flatten() }, { status: 400 }),
          corsOrigin
        )
      }

      const site = pipelineSiteInfo(siteConfig)
      const startedAt = Date.now()
      options.host.scheduleBackground(async () => {
        const ctx = await runPipeline(options, request, site, { tracking: parsed.data })
        // P3.1/P3.2: sampled event counter + bounded log ring (best-effort).
        await recordIngestObservability(options.host, ctx, Date.now() - startedAt)
      })

      return withCors(
        Response.json({ ok: true, accepted: true }, { headers: { 'cache-control': 'no-store' } }),
        corsOrigin
      )
    }

    const ctx = await runPipeline(options, request, pipelineSiteInfo(siteConfig))

    return Response.json(
      { ok: true, consentDecision: ctx.consent?.payload.decision ?? null },
      { headers: { 'cache-control': 'no-store' } }
    )
  }
}
