import type { ConsentCommitRequest } from '@attestrue/types'

/** Worker route handled by `createAttestrackFetchHandler` in `@attestrue/worker-core`. */
export const CONSENT_COMMIT_PATH = '/__attestrack__/consent/commit'

export async function commitPrivacyConsent(
  workerOrigin: string,
  body: ConsentCommitRequest,
  init?: RequestInit
): Promise<{ token: string }> {
  const base = workerOrigin.replace(/\/$/u, '')
  const res = await fetch(`${base}${CONSENT_COMMIT_PATH}`, {
    method: 'POST',
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
 * Persists the opaque consent token as `at_consent` (see `@attestrue/strategies` mandatory consent).
 * Call only in a secure browser context (HTTPS).
 */
export function persistConsentCookie(token: string, maxAgeSec = 31536000): void {
  if (typeof document === 'undefined') return
  const v = encodeURIComponent(token)
  document.cookie = `at_consent=${v}; Path=/; Max-Age=${maxAgeSec}; Secure; SameSite=Lax`
}
