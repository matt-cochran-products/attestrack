import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  fetchConsentContext,
  mountCommunityConsentBanner,
  open,
  CONSENT_CONTEXT_PATH,
  type ConsentContext
} from '../src/banner.js'
import { CONSENT_COMMIT_PATH } from '../src/commit.js'

const CONTEXT: ConsentContext = {
  siteId: 's1',
  mode: 'SHADOW',
  jurisdictionKey: 'EU',
  row: {
    profile: 'standard',
    mechanism: 'opt-in',
    ioa_assertions: [
      { id: 'privacy_policy', text: 'I have reviewed the Privacy Policy.', required: true },
      { id: 'terms', text: 'I agree to the Terms.' }
    ],
    documents: ['privacy_policy', 'terms'],
    gpc_honor: true
  },
  policyRefs: { privacy_policy: '/privacy', terms: '/terms' }
}

function stubFetch(context: ConsentContext | null = CONTEXT) {
  const mock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes(CONSENT_CONTEXT_PATH)) {
      return Promise.resolve(
        context
          ? new Response(JSON.stringify(context), { status: 200 })
          : new Response('nope', { status: 404 })
      )
    }
    return Promise.resolve(new Response(JSON.stringify({ token: 'k1.tok.test' }), { status: 200 }))
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

function commitCalls(mock: ReturnType<typeof vi.fn>) {
  return mock.mock.calls.filter(([input]) => String(input).includes(CONSENT_COMMIT_PATH))
}

function commitBody(mock: ReturnType<typeof vi.fn>, i = 0): Record<string, unknown> {
  const call = commitCalls(mock)[i] as [string, RequestInit]
  return JSON.parse(call[1].body as string) as Record<string, unknown>
}

async function settle() {
  // Let the context fetch + re-render microtasks run.
  await new Promise((r) => setTimeout(r, 0))
}

describe('mountCommunityConsentBanner (P2.4)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.cookie = 'at_consent=; Max-Age=0'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('Accept commits granted with accepted IOA ids and removes the banner', async () => {
    const mock = stubFetch()
    const { unmount } = mountCommunityConsentBanner({
      workerOrigin: 'https://edge.example',
      siteId: 's1',
      policyHash: 'sha256:ab'
    })
    await settle()

    const boxes = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    expect(boxes).toHaveLength(2)
    for (const b of boxes) {
      b.checked = true
      b.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const accept = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Accept')!
    accept.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    await vi.waitFor(() => {
      expect(document.querySelector('[data-attestrack-banner="community"]')).toBeNull()
    })
    const body = commitBody(mock)
    expect(body.decision).toBe('granted')
    expect(body.ioaAccepted).toEqual(['privacy_policy', 'terms'])
    expect(window.__attestrackConsent?.granted).toBe(true)
    unmount()
  })

  it('INV-B-06: Accept is disabled until every required IOA checkbox is checked', async () => {
    stubFetch()
    mountCommunityConsentBanner({
      workerOrigin: 'https://edge.example',
      siteId: 's1',
      policyHash: 'sha256:ab'
    })
    await settle()

    const accept = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Accept')!
    expect(accept.disabled).toBe(true)

    const boxes = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    boxes[0]!.checked = true
    boxes[0]!.dispatchEvent(new Event('change', { bubbles: true }))
    expect(accept.disabled).toBe(true)

    boxes[1]!.checked = true
    boxes[1]!.dispatchEvent(new Event('change', { bubbles: true }))
    expect(accept.disabled).toBe(false)
  })

  it('INV-B-07: Reject all is co-equal with Accept (identical styling) and always enabled', async () => {
    const mock = stubFetch()
    mountCommunityConsentBanner({
      workerOrigin: 'https://edge.example',
      siteId: 's1',
      policyHash: 'sha256:ab'
    })
    await settle()

    const buttons = [...document.querySelectorAll('button')]
    const accept = buttons.find((b) => b.textContent === 'Accept')!
    const reject = buttons.find((b) => b.textContent === 'Reject all')!
    expect(reject.style.cssText).toBe(accept.style.cssText)
    expect(reject.disabled).toBe(false)

    reject.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await vi.waitFor(() => {
      expect(document.querySelector('[data-attestrack-banner="community"]')).toBeNull()
    })
    expect(commitBody(mock).decision).toBe('declined')
    expect(commitBody(mock).ioaAccepted).toBeUndefined()
  })

  it('renders opt-out rows as a notice with OK / Opt out (no checkboxes)', async () => {
    stubFetch({
      ...CONTEXT,
      jurisdictionKey: 'DEFAULT',
      row: {
        ...CONTEXT.row,
        mechanism: 'opt-out',
        ioa_assertions: [{ id: 'primary', text: 'Continued use means you agree.', required: true }]
      }
    })
    mountCommunityConsentBanner({
      workerOrigin: 'https://edge.example',
      siteId: 's1',
      policyHash: 'sha256:ab'
    })
    await settle()

    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(0)
    const labels = [...document.querySelectorAll('button')].map((b) => b.textContent)
    expect(labels).toContain('OK')
    expect(labels).toContain('Opt out')
  })

  it('falls back to generic copy without checkboxes when the context route is unavailable', async () => {
    const mock = stubFetch(null)
    mountCommunityConsentBanner({
      workerOrigin: 'https://edge.example',
      siteId: 's1',
      policyHash: 'sha256:ab'
    })
    await settle()

    expect(document.querySelector('[data-attestrack-banner="community"]')).toBeTruthy()
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(0)
    const accept = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Accept')!
    expect(accept.disabled).toBe(false)
    accept.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await vi.waitFor(() => expect(commitCalls(mock).length).toBe(1))
    expect(commitBody(mock).decision).toBe('granted')
  })

  it('GPC: auto-declines when the resolved row honors GPC (no banner shown)', async () => {
    const mock = stubFetch()
    vi.stubGlobal('navigator', { globalPrivacyControl: true })
    mountCommunityConsentBanner({
      workerOrigin: 'https://edge.example',
      siteId: 's1',
      policyHash: 'sha256:ab'
    })
    await vi.waitFor(() => expect(commitCalls(mock).length).toBe(1))
    expect(commitBody(mock).decision).toBe('declined')
    expect(document.querySelector('[data-attestrack-banner="community"]')).toBeNull()
  })

  it('GPC: shows the banner instead of auto-declining when the row does NOT honor GPC (per-row gpc_honor)', async () => {
    const mock = stubFetch({ ...CONTEXT, row: { ...CONTEXT.row, gpc_honor: false } })
    vi.stubGlobal('navigator', { globalPrivacyControl: true })
    mountCommunityConsentBanner({
      workerOrigin: 'https://edge.example',
      siteId: 's1',
      policyHash: 'sha256:ab'
    })
    await settle()
    expect(commitCalls(mock)).toHaveLength(0)
    expect(document.querySelector('[data-attestrack-banner="community"]')).toBeTruthy()
  })

  it('AttestrackConsent.open() re-opens the banner and offers Withdraw consent after a grant', async () => {
    const mock = stubFetch()
    mountCommunityConsentBanner({
      workerOrigin: 'https://edge.example',
      siteId: 's1',
      policyHash: 'sha256:ab'
    })
    await settle()
    document
      .querySelector('[data-attestrack-banner="community"]')
      ?.remove()

    // Simulate a previously granted cookie (payload is base64url JSON — UI hint only).
    const payload = btoa(
      JSON.stringify({ v: 1, siteId: 's1', decision: 'granted', issuedAt: 'x', policyHash: 'h' })
    )
    document.cookie = `at_consent=${encodeURIComponent(`k1.${payload}.sig`)}`

    const handle = open()
    expect(handle).not.toBeNull()
    await settle()

    const withdraw = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Withdraw consent'
    )!
    expect(withdraw).toBeTruthy()
    expect(withdraw.style.cssText).toBe(
      [...document.querySelectorAll('button')].find((b) => b.textContent === 'Accept')!.style.cssText
    )
    withdraw.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await vi.waitFor(() => {
      expect(commitCalls(mock).length).toBe(1)
    })
    expect(commitBody(mock).decision).toBe('withdrawn')
  })
})

describe('fetchConsentContext', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns null for malformed context payloads', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: 'x' }), { status: 200 }))
    )
    expect(await fetchConsentContext('https://edge.example')).toBeNull()
  })

  it('returns the parsed context on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(CONTEXT), { status: 200 }))
    )
    const ctx = await fetchConsentContext('https://edge.example')
    expect(ctx?.jurisdictionKey).toBe('EU')
    expect(ctx?.row.ioa_assertions).toHaveLength(2)
  })
})
