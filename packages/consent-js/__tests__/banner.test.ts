import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mountCommunityConsentBanner } from '../src/banner.js'
import { CONSENT_COMMIT_PATH } from '../src/commit.js'

describe('mountCommunityConsentBanner', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: 'tok.test' }), { status: 200 }))
    )
    document.body.innerHTML = ''
    document.cookie = ''
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('Accept commits granted, sets cookie, removes banner', async () => {
    const { unmount } = mountCommunityConsentBanner({
      workerOrigin: 'https://edge.example',
      siteId: 's1',
      policyHash: 'sha256:ab'
    })

    const banner = document.querySelector('[data-attestrack-banner="community"]')
    expect(banner).toBeTruthy()

    const accept = document.querySelector('button')
    accept?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    await vi.waitFor(() => {
      expect(document.querySelector('[data-attestrack-banner="community"]')).toBeNull()
    })

    expect(fetch).toHaveBeenCalledWith(
      `https://edge.example${CONSENT_COMMIT_PATH}`,
      expect.objectContaining({ method: 'POST' })
    )
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body.decision).toBe('granted')
    expect(window.__attestrackConsent?.granted).toBe(true)
    unmount()
  })

  it('Decline commits declined', async () => {
    mountCommunityConsentBanner({
      workerOrigin: 'https://edge.example',
      siteId: 's1',
      policyHash: 'sha256:ab'
    })

    const buttons = [...document.querySelectorAll('button')]
    const decline = buttons.find((b) => b.textContent === 'Decline')
    decline?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    await vi.waitFor(() => {
      expect(document.querySelector('[data-attestrack-banner="community"]')).toBeNull()
    })

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body.decision).toBe('declined')
  })
})
