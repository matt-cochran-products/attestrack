/**
 * Portal data-source resolution (stub vs live vs misconfigured).
 *
 * Precedence — the first present source wins and is never silently replaced:
 *
 * 1. **Runtime meta** in the host HTML (deploy-time, no rebuild):
 *    `<meta name="attestrack-portal-api" content="same-origin">` — the portal
 *    calls the Worker portal API on `window.location.origin` only. The one
 *    other accepted value is `stub` (explicit demo deployment, sample data,
 *    visibly labelled). Anything else — URLs, paths, duplicates, empty — is
 *    `misconfigured`; it never falls back to the legacy env or to stubs.
 * 2. **Legacy build-time** `VITE_ATTESTRACK_API_BASE_URL` (deploy CLI, e2e):
 *    an absolute `https:` origin (or `http:` on loopback only), with no
 *    userinfo, path, query or hash. Invalid → `misconfigured`.
 * 3. **Nothing configured:** dev server / vitest (`import.meta.env.DEV`) →
 *    local stub data; a production build → `misconfigured` (fail closed —
 *    never sample data presented as if it came from a deployment).
 *
 * Runtime configuration is deliberately non-secret: no tokens, no Access
 * service credentials, no arbitrary egress URLs. Authentication rides on the
 * browser's Cloudflare Access session cookie (`credentials: 'include'`).
 */

export const RUNTIME_API_META_NAME = 'attestrack-portal-api'

/** Accepted runtime meta values. */
export const RUNTIME_API_SAME_ORIGIN = 'same-origin'
export const RUNTIME_API_DEMO_STUB = 'stub'

export type PortalDataSource =
  | {
      kind: 'live'
      /** Origin only (scheme://host[:port]); never a path, query or hash. */
      base: string
      source: 'runtime-meta' | 'build-env'
    }
  | {
      kind: 'stub'
      /** `local-dev`: dev server / tests with nothing configured. `demo`: explicit runtime meta. */
      reason: 'local-dev' | 'demo'
    }
  | {
      kind: 'misconfigured'
      source: 'runtime-meta' | 'build-env' | 'none'
      reason: string
    }

export interface DataSourceInputs {
  /** `content` of every `<meta name="attestrack-portal-api">` in document order. */
  metaContents: readonly string[]
  /** `window.location.origin`, or null outside a browser. */
  pageOrigin: string | null
  /** `VITE_ATTESTRACK_API_BASE_URL` as compiled into the bundle. */
  legacyBaseUrl: string | undefined
  /** `import.meta.env.DEV` — true only for the Vite dev server and vitest. */
  isDev: boolean
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** True if `s` contains whitespace, ASCII control characters, DEL or a backslash. */
export function hasControlSpaceOrBackslash(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    if (code <= 0x20 || code === 0x7f || code === 0x5c) return true
  }
  return false
}

/**
 * Validate an origin string strictly. Returns the canonical origin or an error.
 * `allowHttpLoopback` keeps `http://localhost:8788`-style local/e2e configs working.
 */
export function parseStrictOrigin(
  raw: string,
  allowHttpLoopback: boolean,
): { ok: true; origin: string } | { ok: false; reason: string } {
  if (hasControlSpaceOrBackslash(raw)) {
    return { ok: false, reason: 'contains whitespace, control characters or backslashes' }
  }
  if (raw.startsWith('//')) {
    return { ok: false, reason: 'protocol-relative URLs are not allowed' }
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'not an absolute URL' }
  }
  if (url.username !== '' || url.password !== '' || raw.includes('@')) {
    return { ok: false, reason: 'userinfo is not allowed' }
  }
  if (url.search !== '' || raw.includes('?')) {
    return { ok: false, reason: 'query strings are not allowed' }
  }
  if (url.hash !== '' || raw.includes('#')) {
    return { ok: false, reason: 'fragments are not allowed' }
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    return { ok: false, reason: 'a path is not allowed (portal routes are fixed under /__attestrack__/portal/v1)' }
  }
  if (url.protocol === 'https:') {
    return { ok: true, origin: url.origin }
  }
  if (url.protocol === 'http:' && allowHttpLoopback && LOOPBACK_HOSTS.has(url.hostname)) {
    return { ok: true, origin: url.origin }
  }
  return { ok: false, reason: `scheme ${url.protocol} is not allowed (https only; http on loopback only)` }
}

export function resolvePortalDataSource(inputs: DataSourceInputs): PortalDataSource {
  const { metaContents, pageOrigin, legacyBaseUrl, isDev } = inputs

  if (metaContents.length > 1) {
    return {
      kind: 'misconfigured',
      source: 'runtime-meta',
      reason: `multiple <meta name="${RUNTIME_API_META_NAME}"> elements — exactly one is allowed`,
    }
  }
  if (metaContents.length === 1) {
    const value = metaContents[0]
    if (value === RUNTIME_API_DEMO_STUB) {
      return { kind: 'stub', reason: 'demo' }
    }
    if (value !== RUNTIME_API_SAME_ORIGIN) {
      return {
        kind: 'misconfigured',
        source: 'runtime-meta',
        reason: `<meta name="${RUNTIME_API_META_NAME}"> must be "${RUNTIME_API_SAME_ORIGIN}" or "${RUNTIME_API_DEMO_STUB}"; URLs and paths are rejected`,
      }
    }
    if (pageOrigin == null) {
      return { kind: 'misconfigured', source: 'runtime-meta', reason: 'page origin is unavailable' }
    }
    // The page's own origin is the only egress target; still validate it so an
    // opaque origin ("null", file:) can never become a base.
    const parsed = parseStrictOrigin(pageOrigin, true)
    if (!parsed.ok) {
      return { kind: 'misconfigured', source: 'runtime-meta', reason: `page origin rejected: ${parsed.reason}` }
    }
    return { kind: 'live', base: parsed.origin, source: 'runtime-meta' }
  }

  if (legacyBaseUrl != null && legacyBaseUrl !== '') {
    const parsed = parseStrictOrigin(legacyBaseUrl, true)
    if (!parsed.ok) {
      return {
        kind: 'misconfigured',
        source: 'build-env',
        reason: `VITE_ATTESTRACK_API_BASE_URL rejected: ${parsed.reason}`,
      }
    }
    return { kind: 'live', base: parsed.origin, source: 'build-env' }
  }

  if (isDev) {
    return { kind: 'stub', reason: 'local-dev' }
  }
  return {
    kind: 'misconfigured',
    source: 'none',
    reason: `no portal API configuration — add <meta name="${RUNTIME_API_META_NAME}" content="${RUNTIME_API_SAME_ORIGIN}"> to the host HTML (see docs/RUNTIME-CONFIG.md)`,
  }
}

function readMetaContents(): string[] {
  if (typeof document === 'undefined') {
    return []
  }
  return Array.from(document.querySelectorAll(`meta[name="${RUNTIME_API_META_NAME}"]`)).map(
    (el) => el.getAttribute('content') ?? '',
  )
}

/** Resolve from the live document + compiled env. Cheap; evaluated per call. */
export function getPortalDataSource(): PortalDataSource {
  return resolvePortalDataSource({
    metaContents: readMetaContents(),
    pageOrigin: typeof window !== 'undefined' && window.location ? window.location.origin : null,
    legacyBaseUrl: import.meta.env.VITE_ATTESTRACK_API_BASE_URL,
    isDev: import.meta.env.DEV === true,
  })
}
