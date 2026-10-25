/**
 * Worker HTTP client. The data source (live Worker, local/demo stubs, or a
 * fail-closed misconfiguration) is resolved by `./runtime-config`.
 *
 * Callers branch on `isLiveApi()`, which is false only for an explicit stub
 * source. A misconfigured source therefore routes callers into
 * `apiGet`/`apiPost`, which throw `PortalConfigError` before any network I/O —
 * a broken production config surfaces as an error, never as sample data.
 */

import { getPortalDataSource, hasControlSpaceOrBackslash, type PortalDataSource } from './runtime-config'

export { getPortalDataSource, type PortalDataSource }

/** Thrown when the portal API configuration is absent (production) or invalid. */
export class PortalConfigError extends Error {
  constructor(readonly reason: string) {
    super(`Portal API is not configured: ${reason}`)
    this.name = 'PortalConfigError'
  }
}

/** Live origin, or '' when the source is stub or misconfigured. */
export function getApiBase(): string {
  const ds = getPortalDataSource()
  return ds.kind === 'live' ? ds.base : ''
}

/** True only for an explicit stub source (local dev with nothing configured, or demo meta). */
export function isStubApi(): boolean {
  return getPortalDataSource().kind === 'stub'
}

/**
 * True when callers must go through the Worker client (live OR misconfigured).
 * Kept under its historical name so every caller's `if (isLiveApi())` branch
 * fails closed on misconfiguration instead of returning stubs.
 */
export function isLiveApi(): boolean {
  return !isStubApi()
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function parseJsonBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/**
 * Build the request URL for an internal portal route. Paths come from code
 * (`PORTAL_WORKER_PREFIX` + route) but are still checked so a crafted value can
 * never redirect a credentialed request to another origin.
 */
export function buildApiUrl(base: string, path: string): string {
  if (
    !path.startsWith('/') ||
    path.startsWith('//') ||
    hasControlSpaceOrBackslash(path) ||
    /[#@]/.test(path) ||
    path.includes('/../') ||
    path.endsWith('/..')
  ) {
    throw new PortalConfigError(`unsafe API path ${JSON.stringify(path)}`)
  }
  const url = new URL(path, base)
  if (url.origin !== base) {
    throw new PortalConfigError('API path resolved outside the configured origin')
  }
  return url.toString()
}

function resolveRequestUrl(path: string): string {
  const ds = getPortalDataSource()
  if (ds.kind === 'misconfigured') {
    throw new PortalConfigError(ds.reason)
  }
  if (ds.kind === 'stub') {
    throw new PortalConfigError('API client called while the portal is in stub mode')
  }
  return buildApiUrl(ds.base, path)
}

async function throwForStatus(res: Response): Promise<never> {
  const text = await res.text();
  const parsed = parseJsonBody(text);
  const msg =
    typeof parsed === 'object' &&
    parsed !== null &&
    'error' in parsed &&
    typeof (parsed as { error: unknown }).error === 'string'
      ? (parsed as { error: string }).error
      : text || res.statusText;
  throw new ApiError(msg, res.status, parsed);
}

/**
 * Authenticated requests never follow redirects (`redirect: 'error'`): a
 * 307/308 would replay a credentialed POST body (e.g. Explore SQL) to whatever
 * origin the `Location` names, and an expired Access session's login redirect
 * must surface as a visible fetch failure rather than an opaque followed page.
 * Recovery is to reauthenticate (reload the portal) — never a stub fallback.
 */
export async function apiGet<T>(path: string): Promise<T> {
  const url = resolveRequestUrl(path);
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    redirect: 'error',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    return throwForStatus(res);
  }
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const url = resolveRequestUrl(path);
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    redirect: 'error',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    return throwForStatus(res);
  }
  return (await res.json()) as T;
}
