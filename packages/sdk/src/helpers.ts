/**
 * Host-agnostic helpers. Cloudflare-specific bindings belong in `@attestrue/host-cloudflare-worker`.
 */

export function headerValue(headers: Headers, name: string): string | null {
  return headers.get(name)
}
