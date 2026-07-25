import type { ConsentDecision } from '@attestrack/types'
import { commitPrivacyConsent, isSameOriginWorker, persistConsentCookie } from './commit.js'
import { readGlobalPrivacyControl } from './gpc.js'
import { initAttestrackClient, markConsentGranted } from './init.js'

export interface MountCommunityBannerOptions {
  workerOrigin: string
  siteId: string
  policyHash: string
  /** CSS selector or element; defaults to `document.body`. */
  container?: string | HTMLElement
  honorGpc?: boolean
  blockCrossOriginFetch?: boolean
}

async function finalizeDecision(
  workerOrigin: string,
  siteId: string,
  policyHash: string,
  decision: ConsentDecision,
  bannerEl: HTMLElement
): Promise<void> {
  const { token } = await commitPrivacyConsent(workerOrigin, {
    siteId,
    decision,
    policyHash
  })
  // The Worker sets the cross-subdomain cookie via Set-Cookie on the commit
  // response; document.cookie is only a same-origin fallback (host-only cookie).
  if (isSameOriginWorker(workerOrigin)) {
    persistConsentCookie(token)
  }
  markConsentGranted(decision === 'granted')
  bannerEl.remove()
}

/**
 * Minimal first-party consent banner: Accept / Decline → Worker commit + cookie + `markConsentGranted`.
 * Call `initAttestrackClient` is invoked here (idempotent with prior init).
 */
export function mountCommunityConsentBanner(opts: MountCommunityBannerOptions): { unmount: () => void } {
  if (typeof document === 'undefined') {
    return { unmount: () => {} }
  }

  initAttestrackClient({
    honorGpc: opts.honorGpc,
    blockCrossOriginFetch: opts.blockCrossOriginFetch
  })

  const mountTo =
    typeof opts.container === 'string'
      ? document.querySelector(opts.container) ?? document.body
      : opts.container ?? document.body

  if (opts.honorGpc !== false && readGlobalPrivacyControl()) {
    const ghost = document.createElement('div')
    ghost.setAttribute('data-attestrack-banner', 'gpc')
    void finalizeDecision(opts.workerOrigin, opts.siteId, opts.policyHash, 'declined', ghost)
    return { unmount: () => {} }
  }

  const wrap = document.createElement('div')
  wrap.setAttribute('data-attestrack-banner', 'community')
  wrap.setAttribute('role', 'region')
  wrap.setAttribute('aria-label', 'Privacy choices')
  wrap.style.cssText =
    'position:fixed;bottom:0;left:0;right:0;z-index:2147483646;padding:12px 16px;font:14px/1.4 system-ui,sans-serif;background:#111;color:#eee;border-top:1px solid #333;display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:center;'

  const text = document.createElement('span')
  text.textContent = 'We use first-party measurement. Choose storage for ads/analytics.'
  text.style.flex = '1'
  text.style.minWidth = '200px'

  const err = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e)
    text.textContent = `Consent request failed: ${msg}`
    text.style.color = '#f88'
  }

  const btnRow = document.createElement('div')
  btnRow.style.display = 'flex'
  btnRow.style.gap = '8px'

  const accept = document.createElement('button')
  accept.type = 'button'
  accept.textContent = 'Accept'
  accept.style.cssText =
    'cursor:pointer;padding:8px 14px;border-radius:6px;border:none;background:#2d7;font-weight:600;color:#fff'

  const decline = document.createElement('button')
  decline.type = 'button'
  decline.textContent = 'Decline'
  decline.style.cssText =
    'cursor:pointer;padding:8px 14px;border-radius:6px;border:1px solid #666;background:transparent;color:#eee'

  accept.addEventListener('click', () => {
    void finalizeDecision(opts.workerOrigin, opts.siteId, opts.policyHash, 'granted', wrap).catch(err)
  })
  decline.addEventListener('click', () => {
    void finalizeDecision(opts.workerOrigin, opts.siteId, opts.policyHash, 'declined', wrap).catch(err)
  })

  btnRow.append(accept, decline)
  wrap.append(text, btnRow)
  mountTo.appendChild(wrap)

  return { unmount: () => wrap.remove() }
}
