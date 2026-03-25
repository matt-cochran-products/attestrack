import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { commitPrivacyConsent, CONSENT_COMMIT_PATH } from '../src/commit.js'

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
})
