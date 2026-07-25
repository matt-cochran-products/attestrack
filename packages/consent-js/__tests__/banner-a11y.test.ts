// @vitest-environment jsdom
/**
 * P6.5 — component-level a11y for the community consent banner: axe scan,
 * keyboard operability (focus start point, Escape dismissal), and the
 * non-modal contract (no focus trap markers). Browser-level keyboard runs
 * live in e2e/journeys/banner-a11y.spec.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { mountCommunityConsentBanner, CONSENT_CONTEXT_PATH, type ConsentContext } from '../src/banner.js'
import { CONSENT_COMMIT_PATH } from '../src/commit.js'

const CONTEXT: ConsentContext = {
  siteId: 's1',
  mode: 'SHADOW',
  jurisdictionKey: 'EU',
  row: {
    profile: 'standard',
    mechanism: 'opt-in',
    ioa_assertions: [{ id: 'primary', text: 'I consent to tracking.', required: true }],
    documents: ['privacy_policy'],
    gpc_honor: true
  },
  policyRefs: { privacy_policy: '/privacy' }
}

function stubFetch() {
  const mock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes(CONSENT_CONTEXT_PATH)) {
      return Promise.resolve(new Response(JSON.stringify(CONTEXT), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify({ token: 'k1.tok.sig' }), { status: 200 }))
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

async function settle() {
  await new Promise((r) => setTimeout(r, 0))
}

const BANNER = '[data-attestrack-banner="community"]'

describe('consent banner a11y (P2.4 exit / P6.5)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('mounts as a labeled region with no serious/critical axe violations', async () => {
    stubFetch()
    mountCommunityConsentBanner({
      workerOrigin: 'https://t.example.com',
      siteId: 's1',
      policyHash: 'sha256:ab'
    })
    await settle()
    const banner = document.querySelector<HTMLElement>(BANNER)
    expect(banner).not.toBeNull()
    expect(banner!.getAttribute('role')).toBe('region')
    expect(banner!.getAttribute('aria-label')).toBe('Privacy choices')

    const results = await axe(banner!)
    const severe = results.violations.filter((v) =>
      ['serious', 'critical'].includes(v.impact ?? '')
    )
    expect(severe.map((v) => `${v.id}: ${v.description}`)).toEqual([])
  })

  it('starts keyboard focus on the first actionable control (required IOA checkbox)', async () => {
    stubFetch()
    mountCommunityConsentBanner({
      workerOrigin: 'https://t.example.com',
      siteId: 's1',
      policyHash: 'sha256:ab'
    })
    await settle()
    // Opt-in row: Accept is disabled until the required box is checked, so the
    // focus start point is the checkbox itself (disabled controls can't focus).
    const active = document.activeElement as HTMLInputElement | null
    expect(active?.tagName).toBe('INPUT')
    expect(active?.getAttribute('data-attestrack-ioa')).toBe('primary')
  })

  it('Escape dismisses the banner WITHOUT committing any decision', async () => {
    const mock = stubFetch()
    mountCommunityConsentBanner({
      workerOrigin: 'https://t.example.com',
      siteId: 's1',
      policyHash: 'sha256:ab'
    })
    await settle()
    const banner = document.querySelector<HTMLElement>(BANNER)!
    banner.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(document.querySelector(BANNER)).toBeNull()
    const commits = mock.mock.calls.filter(([input]) => String(input).includes(CONSENT_COMMIT_PATH))
    expect(commits).toHaveLength(0)
  })

  it('is non-modal: no aria-modal/dialog semantics and page content stays in the tab order', async () => {
    stubFetch()
    document.body.innerHTML = '<button id="page-btn">page button</button>'
    mountCommunityConsentBanner({
      workerOrigin: 'https://t.example.com',
      siteId: 's1',
      policyHash: 'sha256:ab'
    })
    await settle()
    const banner = document.querySelector<HTMLElement>(BANNER)!
    expect(banner.getAttribute('aria-modal')).toBeNull()
    expect(banner.getAttribute('role')).not.toBe('dialog')
    // Page content is not inert/aria-hidden — reachable by keyboard users.
    const pageBtn = document.getElementById('page-btn')!
    expect(pageBtn.closest('[aria-hidden="true"]')).toBeNull()
    expect(pageBtn.hasAttribute('inert')).toBe(false)
  })

  it('every interactive control is natively focusable (buttons, checkboxes, links)', async () => {
    stubFetch()
    mountCommunityConsentBanner({
      workerOrigin: 'https://t.example.com',
      siteId: 's1',
      policyHash: 'sha256:ab'
    })
    await settle()
    const banner = document.querySelector<HTMLElement>(BANNER)!
    const controls = banner.querySelectorAll('button, input, a[href]')
    expect(controls.length).toBeGreaterThanOrEqual(3) // checkbox + accept + reject (+ policy link)
    for (const el of controls) {
      expect((el as HTMLElement).tabIndex).toBeGreaterThanOrEqual(0)
    }
  })
})
