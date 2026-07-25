import type { ConsentDecision, IoaAssertion, JurisdictionConsentRow } from '@attestrack/types'
import { commitPrivacyConsent, isSameOriginWorker, persistConsentCookie } from './commit.js'
import { readGlobalPrivacyControl } from './gpc.js'
import { initAttestrackClient, markConsentGranted } from './init.js'

/** Worker route (see `@attestrack/worker-core`) returning the resolved jurisdiction context. */
export const CONSENT_CONTEXT_PATH = '/__attestrack__/consent/context'

export interface ConsentContext {
  siteId: string
  mode: string
  jurisdictionKey: string
  row: JurisdictionConsentRow
  policyRefs: Record<string, string>
}

/** Fetch the resolved jurisdiction row for config-driven banner copy (null on any failure). */
export async function fetchConsentContext(workerOrigin: string): Promise<ConsentContext | null> {
  try {
    const base = workerOrigin.replace(/\/$/u, '')
    const res = await fetch(`${base}${CONSENT_CONTEXT_PATH}`, { credentials: 'include' })
    if (!res.ok) return null
    const data = (await res.json()) as Partial<ConsentContext> | null
    if (!data || typeof data !== 'object') return null
    const row = data.row
    if (!row || !Array.isArray(row.ioa_assertions) || row.ioa_assertions.length === 0) return null
    return data as ConsentContext
  } catch {
    return null
  }
}

/**
 * Best-effort read of the current decision from the `at_consent` cookie payload —
 * a UI hint only (drives the Withdraw button); NEVER a verification. The Worker
 * re-verifies the HMAC on every request.
 */
export function readConsentCookieDecision(): ConsentDecision | null {
  if (typeof document === 'undefined') return null
  const m = /(?:^|;\s*)at_consent=([^;]+)/u.exec(document.cookie)
  if (!m) return null
  try {
    const token = decodeURIComponent(m[1]!)
    const parts = token.split('.')
    const payloadPart = parts.length === 3 ? parts[1]! : parts[0]!
    const b64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(b64)) as { decision?: ConsentDecision }
    return payload.decision ?? null
  } catch {
    return null
  }
}

export interface MountCommunityBannerOptions {
  workerOrigin: string
  siteId: string
  policyHash: string
  /** CSS selector or element; defaults to `document.body`. */
  container?: string | HTMLElement
  honorGpc?: boolean
  blockCrossOriginFetch?: boolean
}

/** INV-B-07: Accept and Reject all use the SAME style — visually co-equal. */
const BTN_STYLE =
  'cursor:pointer;padding:8px 14px;border-radius:6px;border:1px solid #888;background:#333;color:#fff;font-weight:600;font-size:14px'

const FALLBACK_ASSERTION: IoaAssertion = {
  id: 'primary',
  text: 'We use first-party measurement. Choose storage for ads/analytics.',
  required: true
}

let lastMountOptions: MountCommunityBannerOptions | null = null

async function finalizeDecision(
  opts: MountCommunityBannerOptions,
  decision: ConsentDecision,
  ioaAccepted: readonly string[] | undefined,
  bannerEl: HTMLElement
): Promise<void> {
  const { token } = await commitPrivacyConsent(opts.workerOrigin, {
    siteId: opts.siteId,
    decision,
    policyHash: opts.policyHash,
    ...(ioaAccepted && ioaAccepted.length > 0 ? { ioaAccepted } : {})
  })
  // The Worker sets the cross-subdomain cookie via Set-Cookie on the commit
  // response; document.cookie is only a same-origin fallback (host-only cookie).
  if (isSameOriginWorker(opts.workerOrigin)) {
    persistConsentCookie(token)
  }
  markConsentGranted(decision === 'granted')
  bannerEl.remove()
}

function renderBanner(
  opts: MountCommunityBannerOptions,
  context: ConsentContext | null,
  wrap: HTMLElement
): void {
  wrap.textContent = ''
  const row = context?.row
  const mechanism = row?.mechanism ?? 'opt-in'
  const assertions: readonly IoaAssertion[] = row?.ioa_assertions ?? [FALLBACK_ASSERTION]

  const err = (e: unknown, textEl: HTMLElement) => {
    const msg = e instanceof Error ? e.message : String(e)
    textEl.textContent = `Consent request failed: ${msg}`
    textEl.style.color = '#f88'
  }

  const content = document.createElement('div')
  content.style.cssText = 'flex:1;min-width:200px;display:flex;flex-direction:column;gap:6px'

  const statusLine = document.createElement('span')
  content.appendChild(statusLine)

  // INV-B-06: assertions marked required (default) are rendered as required
  // checkboxes for opt-in mechanisms — there is no API to disable this.
  const requiredBoxes: HTMLInputElement[] = []
  const allBoxes: { id: string; input: HTMLInputElement }[] = []
  if (mechanism === 'opt-in' && context) {
    for (const a of assertions) {
      const label = document.createElement('label')
      label.style.cssText = 'display:flex;gap:8px;align-items:flex-start;cursor:pointer'
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.setAttribute('data-attestrack-ioa', a.id)
      const span = document.createElement('span')
      span.textContent = a.text
      label.append(input, span)
      content.appendChild(label)
      allBoxes.push({ id: a.id, input })
      if (a.required !== false) requiredBoxes.push(input)
    }
  } else {
    // opt-out mechanism (or no config context): notice lines, no checkboxes.
    for (const a of assertions) {
      const span = document.createElement('span')
      span.textContent = a.text
      content.appendChild(span)
    }
  }

  // Policy links from the resolved context (documents → served routes).
  if (context && Object.keys(context.policyRefs).length > 0) {
    const links = document.createElement('span')
    for (const [doc, path] of Object.entries(context.policyRefs)) {
      const a = document.createElement('a')
      a.href = `${opts.workerOrigin.replace(/\/$/u, '')}${path}`
      a.textContent = doc.replace(/_/g, ' ')
      a.style.cssText = 'color:#9cf;margin-right:12px'
      a.target = '_blank'
      a.rel = 'noreferrer'
      links.appendChild(a)
    }
    content.appendChild(links)
  }

  const btnRow = document.createElement('div')
  btnRow.style.cssText = 'display:flex;gap:8px;align-items:center'

  const accept = document.createElement('button')
  accept.type = 'button'
  accept.textContent = mechanism === 'opt-out' ? 'OK' : 'Accept'
  accept.style.cssText = BTN_STYLE

  const reject = document.createElement('button')
  reject.type = 'button'
  reject.textContent = mechanism === 'opt-out' ? 'Opt out' : 'Reject all'
  reject.style.cssText = BTN_STYLE

  const syncAcceptEnabled = () => {
    accept.disabled = requiredBoxes.some((b) => !b.checked)
  }
  for (const { input } of allBoxes) input.addEventListener('change', syncAcceptEnabled)
  syncAcceptEnabled()

  accept.addEventListener('click', () => {
    const acceptedIds = allBoxes.filter((b) => b.input.checked).map((b) => b.id)
    void finalizeDecision(opts, 'granted', acceptedIds, wrap).catch((e) => err(e, statusLine))
  })
  reject.addEventListener('click', () => {
    void finalizeDecision(opts, 'declined', undefined, wrap).catch((e) => err(e, statusLine))
  })
  btnRow.append(accept, reject)

  // Withdrawal path: visible whenever a prior grant is detectable client-side.
  if (readConsentCookieDecision() === 'granted') {
    const withdraw = document.createElement('button')
    withdraw.type = 'button'
    withdraw.textContent = 'Withdraw consent'
    withdraw.style.cssText = BTN_STYLE
    withdraw.addEventListener('click', () => {
      void finalizeDecision(opts, 'withdrawn', undefined, wrap).catch((e) => err(e, statusLine))
    })
    btnRow.appendChild(withdraw)
  }

  wrap.append(content, btnRow)
  accept.focus()
}

/**
 * First-party consent banner (P2.4): copy and checkboxes driven by the resolved
 * jurisdiction row from `GET /__attestrack__/consent/context`; GPC honored per
 * row (`gpc_honor`); Reject all co-equal with Accept (INV-B-07); withdrawal via
 * a Withdraw button or `AttestrackConsent.open()`.
 */
export function mountCommunityConsentBanner(opts: MountCommunityBannerOptions): { unmount: () => void } {
  if (typeof document === 'undefined') {
    return { unmount: () => {} }
  }

  lastMountOptions = opts

  initAttestrackClient({
    honorGpc: opts.honorGpc,
    blockCrossOriginFetch: opts.blockCrossOriginFetch
  })

  const mountTo =
    typeof opts.container === 'string'
      ? document.querySelector(opts.container) ?? document.body
      : opts.container ?? document.body

  const gpcSignal = opts.honorGpc !== false && readGlobalPrivacyControl()

  const wrap = document.createElement('div')
  wrap.setAttribute('data-attestrack-banner', 'community')
  wrap.setAttribute('role', 'region')
  wrap.setAttribute('aria-label', 'Privacy choices')
  wrap.style.cssText =
    'position:fixed;bottom:0;left:0;right:0;z-index:2147483646;padding:12px 16px;font:14px/1.4 system-ui,sans-serif;background:#111;color:#eee;border-top:1px solid #333;display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:center;'

  if (gpcSignal) {
    // Per-row GPC honoring (P2.3): only auto-decline when the resolved row honors GPC.
    void fetchConsentContext(opts.workerOrigin).then((context) => {
      const honor = context ? context.row.gpc_honor : true
      if (honor) {
        const ghost = document.createElement('div')
        ghost.setAttribute('data-attestrack-banner', 'gpc')
        void finalizeDecision(opts, 'declined', undefined, ghost).catch(() => {})
        return
      }
      renderBanner(opts, context, wrap)
      mountTo.appendChild(wrap)
    })
    return { unmount: () => wrap.remove() }
  }

  // Render immediately with fallback copy, then swap to config-driven copy when
  // the context arrives (skipped if the visitor already decided meanwhile).
  renderBanner(opts, null, wrap)
  mountTo.appendChild(wrap)
  void fetchConsentContext(opts.workerOrigin).then((context) => {
    if (context && wrap.isConnected) renderBanner(opts, context, wrap)
  })

  return { unmount: () => wrap.remove() }
}

/**
 * Re-open the banner (withdrawal / change-of-mind path): `AttestrackConsent.open()`.
 * Uses the options from the last `mountCommunityConsentBanner` call.
 */
export function open(): { unmount: () => void } | null {
  if (!lastMountOptions || typeof document === 'undefined') return null
  const existing = document.querySelector('[data-attestrack-banner="community"]')
  existing?.remove()
  // Re-opening is an explicit user action — never auto-decline via GPC here.
  return mountCommunityConsentBanner({ ...lastMountOptions, honorGpc: false })
}
