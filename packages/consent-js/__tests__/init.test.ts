import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  initAttestrackClient,
  installCrossOriginFetchGuard,
  markConsentGranted
} from '../src/init.js'

describe('initAttestrackClient', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { globalPrivacyControl: true })
    vi.stubGlobal('location', { href: 'https://client.example/page', origin: 'https://client.example' })
    vi.stubGlobal('window', {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('records GPC on window state', () => {
    initAttestrackClient({ honorGpc: true, blockCrossOriginFetch: false })
    expect(window.__attestrackConsent?.gpc).toBe(true)
  })
})

describe('installCrossOriginFetchGuard', () => {
  beforeEach(() => {
    vi.stubGlobal('location', { href: 'https://client.example/', origin: 'https://client.example' })
    vi.stubGlobal('window', { __attestrackConsent: { granted: false } })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('blocks cross-origin fetch until consent', async () => {
    const orig = vi.fn().mockResolvedValue(new Response('ok'))
    vi.stubGlobal('fetch', orig)
    installCrossOriginFetchGuard()
    await expect(fetch('https://other.example/x')).rejects.toThrow(/blocked/)
    markConsentGranted(true)
    await fetch('https://other.example/x')
    expect(orig).toHaveBeenCalled()
  })
})
