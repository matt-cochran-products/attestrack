/**
 * Worker HTTP client. When `VITE_ATTESTRACK_API_BASE_URL` is unset, callers use stub data.
 */

export function getApiBase(): string {
  const raw = import.meta.env.VITE_ATTESTRACK_API_BASE_URL;
  if (raw == null || raw === '') {
    return '';
  }
  return raw.replace(/\/$/, '');
}

export function isLiveApi(): boolean {
  return getApiBase() !== '';
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

export async function apiGet<T>(path: string): Promise<T> {
  const base = getApiBase();
  if (!base) {
    throw new Error('API base URL is not configured');
  }
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
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
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const base = getApiBase();
  if (!base) {
    throw new Error('API base URL is not configured');
  }
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
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
  return (await res.json()) as T;
}
