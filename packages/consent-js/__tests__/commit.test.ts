import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { commitPrivacyConsent, sendTrackingEvent, CONSENT_COMMIT_PATH } from '../src/commit.js'
import { TRACKING_EVENT_PATH } from '../src/paths.js'

describe('commitPrivacyConsent', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs to worker consent commit path', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ token: 'abc.def' }), { status: 200 })
    )
    const out = await commitPrivacyConsent('https://edge.example', {
      siteId: 's',
      decision: 'granted',
      policyHash: 'sha256:x'
    })
    expect(out.token).toBe('abc.def')
    expect(mockFetch).toHaveBeenCalledWith(
      `https://edge.example${CONSENT_COMMIT_PATH}`,
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('sends credentials: include so the cross-subdomain Set-Cookie round-trip works (P2.1)', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ token: 't' }), { status: 200 }))
    await commitPrivacyConsent('https://t.example.com', {
      siteId: 's',
      decision: 'granted',
      policyHash: 'sha256:x'
    })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ credentials: 'include' })
    )
  })
})

describe('sendTrackingEvent', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs the event with credentials: include so the consent cookie reaches the worker (P2.1)', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    await sendTrackingEvent('https://t.example.com', {
      v: 1,
      eventName: 'page_view',
      siteId: 's',
      occurredAt: new Date().toISOString()
    })
    expect(mockFetch).toHaveBeenCalledWith(
      `https://t.example.com${TRACKING_EVENT_PATH}`,
      expect.objectContaining({ method: 'POST', credentials: 'include' })
    )
  })
})
