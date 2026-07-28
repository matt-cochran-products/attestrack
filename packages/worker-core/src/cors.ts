import type { SiteConfigKv } from './config.js'

/**
 * CORS allowlist for browser-facing routes (`/t/event`, consent commit/context).
 * Derived from site config: the registered `domain` (plus subdomains) and every
 * `trustedDomains` entry (exact host or subdomain). No wildcard reflection —
 * credentialed CORS must never echo arbitrary origins.
 */

function hostMatches(hostname: string, allowedHost: string): boolean {
  if (!allowedHost) return false
  return hostname === allowedHost || hostname.endsWith(`.${allowedHost}`)
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

/** True when `origin` (an `Origin` header value) is allowed to make credentialed requests. */
export function isOriginAllowed(origin: string, config: Pick<SiteConfigKv, 'domain' | 'trustedDomains'>): boolean {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  const allowedHosts = [config.domain, ...config.trustedDomains]
  // Loopback origins (any scheme/port) are allowed only when explicitly listed.
  if (isLoopback(url.hostname)) {
    return allowedHosts.some((h) => h === url.hostname || h === url.host)
  }
  if (url.protocol !== 'https:') return false
  return allowedHosts.some((h) => hostMatches(url.hostname, h) || h === url.host)
}

/**
 * Resolve the `Origin` header against the allowlist.
 * Returns the origin string to echo, or null (same-origin request or disallowed origin).
 */
export function resolveCorsOrigin(
  request: Request,
  config: Pick<SiteConfigKv, 'domain' | 'trustedDomains'>
): string | null {
  const origin = request.headers.get('origin')
  if (!origin || origin === 'null') return null
  return isOriginAllowed(origin, config) ? origin : null
}

export function corsHeaders(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    vary: 'Origin'
  }
}

/** Wrap a response with credentialed CORS headers when the origin is allowed. */
export function withCors(response: Response, origin: string | null): Response {
  if (!origin) return response
  const headers = new Headers(response.headers)
  for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v)
  return new Response(response.body, { status: response.status, headers })
}

/** Preflight response for CORS-enabled routes. Disallowed origins get 204 without CORS headers. */
export function preflightResponse(
  request: Request,
  config: Pick<SiteConfigKv, 'domain' | 'trustedDomains'>,
  allowMethods: string
): Response {
  const origin = resolveCorsOrigin(request, config)
  if (!origin) return new Response(null, { status: 204, headers: { vary: 'Origin' } })
  const requestedHeaders = request.headers.get('access-control-request-headers')
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(origin),
      'access-control-allow-methods': allowMethods,
      'access-control-allow-headers': requestedHeaders ?? 'content-type',
      'access-control-max-age': '86400'
    }
  })
}
