// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PORTAL_WORKER_PREFIX } from './constants'

vi.mock('./delay', () => ({ stubDelay: () => Promise.resolve() }))

function setMeta(...contents: string[]) {
  for (const content of contents) {
    const el = document.createElement('meta')
    el.setAttribute('name', 'attestrack-portal-api')
    el.setAttribute('content', content)
    document.head.appendChild(el)
  }
}

function asProductionBuild() {
  vi.stubEnv('DEV', false)
  vi.stubEnv('PROD', true)
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

type FetchArgs = Parameters<typeof fetch>

/** First recorded fetch call; fails the test (instead of using `!`) when fetch was never called. */
function firstFetchCall(fetchMock: { mock: { calls: FetchArgs[] } }): FetchArgs {
  const call = fetchMock.mock.calls[0]
  if (call === undefined) throw new Error('expected fetch to have been called')
  return call
}

const EXPLORE_RESULT = { columns: ['eventName'], rows: [{ eventName: 'x' }], rowCount: 1, truncated: false }
const SQL = 'SELECT eventName FROM events LIMIT 1'

describe('portal runtime configuration — HTTP client (same-origin meta)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_ATTESTRACK_API_BASE_URL', '')
  })

  afterEach(() => {
    document.head.querySelectorAll('meta[name="attestrack-portal-api"]').forEach((el) => el.remove())
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('runtime same-origin meta sends the live Explore query to the page origin with credentials', async () => {
    asProductionBuild()
    setMeta('same-origin')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(EXPLORE_RESULT))
    const { runExploreQuery } = await import('./explore')

    await expect(runExploreQuery(SQL)).resolves.toEqual(EXPLORE_RESULT)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = firstFetchCall(fetchMock)
    expect(url).toBe(`${window.location.origin}${PORTAL_WORKER_PREFIX}/explore/query`)
    // redirect: 'error' — a 307/308 must never replay the SQL body to another origin.
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', redirect: 'error' })
    expect(JSON.parse(String(init?.body))).toEqual({ sql: SQL })
    // No embedded service token / Access bypass headers.
    const headers = new Headers(init?.headers)
    expect(headers.has('authorization')).toBe(false)
    expect(headers.has('cf-access-client-id')).toBe(false)
    expect(headers.has('cf-access-client-secret')).toBe(false)
  })

  it('authenticated GET also uses credentials include on the same origin', async () => {
    asProductionBuild()
    setMeta('same-origin')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([]))
    const { listSavedQueries } = await import('./explore')

    await listSavedQueries()

    const [url, init] = firstFetchCall(fetchMock)
    expect(url).toBe(`${window.location.origin}${PORTAL_WORKER_PREFIX}/explore/saved-queries`)
    expect(init).toMatchObject({ method: 'GET', credentials: 'include', redirect: 'error' })
  })

  it('an Access login redirect fails visibly — redirect is not followed, no stub fallback', async () => {
    asProductionBuild()
    setMeta('same-origin')
    // With redirect: 'error', fetch rejects with a TypeError on any 3xx.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    const { runExploreQuery, listSavedQueries } = await import('./explore')

    await expect(runExploreQuery(SQL)).rejects.toThrow('Failed to fetch')
    await expect(listSavedQueries()).rejects.toThrow('Failed to fetch')
  })

  it('runtime meta overrides a compiled legacy URL (same artifact, different host config)', async () => {
    asProductionBuild()
    vi.stubEnv('VITE_ATTESTRACK_API_BASE_URL', 'https://legacy-worker.example.net')
    setMeta('same-origin')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([]))
    const { listSavedQueries } = await import('./explore')

    await listSavedQueries()
    const [url] = firstFetchCall(fetchMock)
    expect(String(url).startsWith(`${window.location.origin}/`)).toBe(true)
  })

  it('production build with no configuration fails closed — no fetch, no sample data', async () => {
    asProductionBuild()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const { runExploreQuery } = await import('./explore')
    const { getDashboardMetrics } = await import('./dashboard')
    const { getCuratedChart } = await import('./analytics')
    const { PortalConfigError } = await import('./http')

    await expect(runExploreQuery(SQL)).rejects.toBeInstanceOf(PortalConfigError)
    await expect(getDashboardMetrics()).rejects.toBeInstanceOf(PortalConfigError)
    await expect(
      getCuratedChart('events-volume', { dateFrom: '2026-01-01', dateTo: '2026-01-07' }),
    ).rejects.toBeInstanceOf(PortalConfigError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['https://evil.example.com', '//evil.example.com', '/api', 'same-origin?x=1'])(
    'invalid runtime meta %j fails closed and never uses the legacy URL or stubs',
    async (content) => {
      vi.stubEnv('VITE_ATTESTRACK_API_BASE_URL', 'https://legacy-worker.example.net')
      setMeta(content)
      const fetchMock = vi.spyOn(globalThis, 'fetch')
      const { runExploreQuery } = await import('./explore')
      const { PortalConfigError, isLiveApi, getApiBase } = await import('./http')

      expect(isLiveApi()).toBe(true) // routes callers into the failing client, not stubs
      expect(getApiBase()).toBe('')
      await expect(runExploreQuery(SQL)).rejects.toBeInstanceOf(PortalConfigError)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('invalid legacy build URL in production fails closed', async () => {
    asProductionBuild()
    vi.stubEnv('VITE_ATTESTRACK_API_BASE_URL', 'https://user@worker.example.net/path?q#h')
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const { getDashboardMetrics } = await import('./dashboard')
    const { PortalConfigError } = await import('./http')

    await expect(getDashboardMetrics()).rejects.toBeInstanceOf(PortalConfigError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('local dev with nothing configured keeps stub sample data (no network)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const { runExploreQuery } = await import('./explore')
    const { isStubApi } = await import('./http')

    expect(isStubApi()).toBe(true)
    const r = await runExploreQuery(SQL)
    expect(r.rowCount).toBeGreaterThan(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([401, 403])('HTTP %i from the Worker surfaces as ApiError — no stub fallback', async (status) => {
    asProductionBuild()
    setMeta('same-origin')
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(jsonResponse({ error: 'forbidden' }, status)),
    )
    const { runExploreQuery } = await import('./explore')
    const { getDashboardMetrics } = await import('./dashboard')
    const { ApiError } = await import('./http')

    const err = await runExploreQuery(SQL).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as InstanceType<typeof ApiError>).status).toBe(status)
    await expect(getDashboardMetrics()).rejects.toBeInstanceOf(ApiError)
  })

  it('network failure propagates — no stub fallback', async () => {
    asProductionBuild()
    setMeta('same-origin')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    const { runExploreQuery } = await import('./explore')

    await expect(runExploreQuery(SQL)).rejects.toThrow('Failed to fetch')
  })
})

describe('buildApiUrl — route injection guards', () => {
  it.each([
    '//evil.example.com/x',
    'https://evil.example.com/x',
    'relative/path',
    '/x#frag',
    '/x@evil',
    '/\\evil.example.com',
    '/__attestrack__/portal/v1/../../admin',
    '/x y',
  ])('rejects %j', async (path) => {
    const { buildApiUrl, PortalConfigError } = await import('./http')
    expect(() => buildApiUrl('https://portal.example.com', path)).toThrow(PortalConfigError)
  })

  it('accepts internal routes with a query string', async () => {
    const { buildApiUrl } = await import('./http')
    expect(buildApiUrl('https://portal.example.com', `${PORTAL_WORKER_PREFIX}/signal-recovery/timeline?days=7`)).toBe(
      `https://portal.example.com${PORTAL_WORKER_PREFIX}/signal-recovery/timeline?days=7`,
    )
  })
})
