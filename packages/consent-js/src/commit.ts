import type { ConsentCommitRequest, TrackingEventV1 } from '@attestrack/types'
import { TRACKING_EVENT_PATH } from './paths.js'

/** Worker route handled by `createAttestrackFetchHandler` in `@attestrack/worker-core`. */
export const CONSENT_COMMIT_PATH = '/__attestrack__/consent/commit'

export async function commitPrivacyConsent(
  workerOrigin: string,
  body: ConsentCommitRequest,
  init?: RequestInit
): Promise<{ token: string }> {
  const base = workerOrigin.replace(/\/$/u, '')
  const res = await fetch(`${base}${CONSENT_COMMIT_PATH}`, {
    method: 'POST',
    // Cross-subdomain topology (page on www., worker on t.): the Worker sets the
    // at_consent cookie via Set-Cookie, which requires credentialed CORS.
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init?.headers as HeadersInit) },
    body: JSON.stringify(body),
    ...init
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`consent_commit_failed:${res.status}:${text}`)
  }
  return res.json() as Promise<{ token: string }>
}

/**
 * Same-origin fallback ONLY: persists the consent token as a host-only `at_consent`
 * cookie via `document.cookie`. In the documented cross-subdomain topology the
 * WORKER sets this cookie on the commit response (`Set-Cookie` with `Domain` from
 * site config) — a host-only cookie written on the page origin would never reach
 * the tracking subdomain. Call only when the worker shares the page origin.
 */
export function persistConsentCookie(token: string, maxAgeSec = 31536000): void {
  if (typeof document === 'undefined') return
  const v = encodeURIComponent(token)
  document.cookie = `at_consent=${v}; Path=/; Max-Age=${maxAgeSec}; Secure; SameSite=Lax`
}

/** True when `workerOrigin` is the page's own origin (document.cookie fallback is meaningful). */
export function isSameOriginWorker(workerOrigin: string): boolean {
  if (typeof location === 'undefined') return false
  try {
    return new URL(workerOrigin, location.href).origin === location.origin
  } catch {
    return false
  }
}

/** POST a canonical tracking event to the first-party worker (non-blocking friendly). */
export async function sendTrackingEvent(
  workerOrigin: string,
  event: TrackingEventV1,
  init?: RequestInit
): Promise<void> {
  const base = workerOrigin.replace(/\/$/u, '')
  await fetch(`${base}${TRACKING_EVENT_PATH}`, {
    method: 'POST',
    // Send the at_consent cookie cross-origin so the Worker consent gate sees it.
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init?.headers as HeadersInit) },
    body: JSON.stringify(event),
    ...init
  })
}
