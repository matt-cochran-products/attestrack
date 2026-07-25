import { describe, expect, it } from 'vitest'
import { runDeployVerify, type FetchLike } from '../src/index.js'

type MockRoute = {
  status: number
  body?: string
  headers?: Record<string, string>
}

function mockFetch(routes: (url: string, init?: Parameters<FetchLike>[1]) => MockRoute | undefined): {
  fetchFn: FetchLike
  calls: string[]
} {
  const calls: string[] = []
  const fetchFn: FetchLike = async (url, init) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    const r = routes(url, init)
    if (!r) throw new Error(`network error: ${url}`)
    return {
      status: r.status,
      headers: { get: (n: string) => r.headers?.[n.toLowerCase()] ?? null },
      text: async () => r.body ?? ''
    }
  }
  return { fetchFn, calls }
}

const noSleep = async () => {}
const silent = () => {}

describe('runDeployVerify (P5.3 + CLI.8)', () => {
  it('passes when worker healthy, domain routed, portal behind Access, consent commit works', async () => {
    const { fetchFn } = mockFetch((url, init) => {
      if (url === 'https://w.workers.dev/health') return { status: 200, body: 'ok' }
      if (url === 'https://t.acme.test/health') return { status: 200, body: 'ok' }
      if (url === 'https://portal.pages.dev')
        return { status: 302, headers: { location: 'https://acme.cloudflareaccess.com/cdn-cgi/access/login' } }
      if (url === 'https://w.workers.dev/__attestrack__/consent/commit' && init?.method === 'POST')
        return { status: 200, body: '{"token":"abc"}' }
      return undefined
    })
    const report = await runDeployVerify({
      workerUrl: 'https://w.workers.dev',
      domain: 't.acme.test',
      portalUrl: 'https://portal.pages.dev',
      siteId: 'acme',
      fetchFn,
      sleep: noSleep,
      write: silent
    })
    expect(report).toEqual({
      workerHealth: 'ok',
      domainRoute: 'ok',
      portalAccess: 'protected',
      consentCommit: 'ok',
      ok: true
    })
  })

  it('reports domain PENDING (not failure) while DNS propagates — wait up to 24h', async () => {
    const out: string[] = []
    const { fetchFn, calls } = mockFetch((url, init) => {
      if (url === 'https://w.workers.dev/health') return { status: 200, body: 'ok' }
      if (url === 'https://t.slow.test/health') return undefined // DNS not resolving yet
      if (url.endsWith('/consent/commit') && init?.method === 'POST') return { status: 200, body: '{"token":"t"}' }
      return undefined
    })
    const report = await runDeployVerify({
      workerUrl: 'https://w.workers.dev',
      domain: 't.slow.test',
      fetchFn,
      attempts: 3,
      sleep: noSleep,
      write: (s) => out.push(s)
    })
    expect(report.domainRoute).toBe('pending')
    expect(report.ok).toBe(true) // propagation is not a deploy failure
    expect(calls.filter((c) => c.includes('t.slow.test')).length).toBe(3)
    expect(out.join('')).toContain('up to 24 hours')
  })

  it('warns loudly when the portal is public (no Access redirect)', async () => {
    const out: string[] = []
    const { fetchFn } = mockFetch((url, init) => {
      if (url.endsWith('/health')) return { status: 200, body: 'ok' }
      if (url === 'https://portal.pages.dev') return { status: 200, body: '<html>portal</html>' }
      if (url.endsWith('/consent/commit') && init?.method === 'POST') return { status: 200, body: '{"token":"t"}' }
      return undefined
    })
    const report = await runDeployVerify({
      workerUrl: 'https://w.workers.dev',
      portalUrl: 'https://portal.pages.dev',
      fetchFn,
      sleep: noSleep,
      write: (s) => out.push(s)
    })
    expect(report.portalAccess).toBe('unprotected')
    expect(out.join('')).toContain('PUBLIC')
  })

  it('fails hard when the consent secret is missing (503) or worker unhealthy', async () => {
    const { fetchFn } = mockFetch((url, init) => {
      if (url.endsWith('/health')) return { status: 200, body: 'ok' }
      if (url.endsWith('/consent/commit') && init?.method === 'POST')
        return { status: 503, body: '{"error":"consent_secret_not_configured"}' }
      return undefined
    })
    const report = await runDeployVerify({
      workerUrl: 'https://w.workers.dev',
      fetchFn,
      sleep: noSleep,
      write: silent
    })
    expect(report.consentCommit).toBe('secret_not_configured')
    expect(report.ok).toBe(false)

    const down = mockFetch(() => undefined)
    const report2 = await runDeployVerify({
      workerUrl: 'https://down.workers.dev',
      fetchFn: down.fetchFn,
      sleep: noSleep,
      write: silent
    })
    expect(report2.workerHealth).toBe('fail')
    expect(report2.ok).toBe(false)
  })
})
