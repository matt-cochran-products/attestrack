import { readGlobalPrivacyControl } from './gpc.js'

declare global {
  interface Window {
    __attestrackConsent?: { granted: boolean; gpc?: boolean }
  }
}

let guardInstalled = false

/**
 * Optional: block cross-origin `fetch` until `markConsentGranted()` runs.
 * Call synchronously in `<head>` before third-party tags load when you want hard browser-side gating.
 */
export function installCrossOriginFetchGuard(): void {
  if (guardInstalled || typeof globalThis.fetch !== 'function') return
  guardInstalled = true
  const orig = globalThis.fetch.bind(globalThis) as typeof fetch
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const granted =
      typeof window !== 'undefined' ? window.__attestrackConsent?.granted === true : false
    if (granted) return orig(input, init)
    let href: string
    if (typeof input === 'string') href = input
    else if (input instanceof URL) href = input.href
    else href = input.url
    const resolved = new URL(
      href,
      typeof location !== 'undefined' ? location.href : 'https://localhost/'
    )
    const sameOrigin =
      typeof location !== 'undefined' && resolved.origin === location.origin
    if (sameOrigin) return orig(input, init)
    return Promise.reject(new Error('attestrack: outbound fetch blocked until consent'))
  }
}

export function markConsentGranted(granted: boolean): void {
  if (typeof window === 'undefined') return
  window.__attestrackConsent = {
    ...(window.__attestrackConsent ?? {}),
    granted
  }
}

export function initAttestrackClient(opts?: { blockCrossOriginFetch?: boolean; honorGpc?: boolean }) {
  if (typeof window === 'undefined') return
  const gpc = opts?.honorGpc !== false && readGlobalPrivacyControl()
  window.__attestrackConsent = {
    granted: false,
    gpc: gpc || undefined
  }
  if (opts?.blockCrossOriginFetch) {
    installCrossOriginFetchGuard()
  }
}
