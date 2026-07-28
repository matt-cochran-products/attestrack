/**
 * Runtime ports for any edge or server host (Cloudflare Workers, Node, etc.).
 * Implementations live in packages like `@attestrack/host-cloudflare-worker`.
 */

export interface HostKeyValue {
  get(key: string): Promise<string | undefined | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
}

export interface HostRuntime {
  readonly kv: HostKeyValue
  /** ISO 3166-1 alpha-2 when known (e.g. CF-IPCountry). */
  geoCountry(request: Request): string | null
  /** Fire-and-forget work after the response is returned (e.g. waitUntil). */
  scheduleBackground(task: () => void | Promise<void>): void
  /** Named secrets from the host environment (never logged). */
  getSecret(name: string): string | undefined
  /**
   * Optional host bot score for a request (P3.4 troll-shield passthrough).
   * Cloudflare Bot Management convention: 1–29 = likely automated, 30+ human,
   * `null` when the host/plan provides no score. Hosts without bot detection
   * simply omit this port.
   */
  botScore?(request: Request): number | null
}
