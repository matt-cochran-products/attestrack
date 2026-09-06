import type { HostKeyValue, HostRuntime } from '@attestrack/host-contracts'

function kvNamespaceAdapter(ns: KVNamespace): HostKeyValue {
  return {
    async get(key) {
      const v = await ns.get(key)
      return v ?? undefined
    },
    async put(key, value, options) {
      await ns.put(key, value, options)
    },
    async delete(key) {
      await ns.delete(key)
    }
  }
}

export interface CloudflareHostBindings {
  kv: KVNamespace
  secrets?: Record<string, string | undefined>
  outbound?: Record<string, Fetcher | undefined>
}

export interface CloudflareHostOptions {
  bindings: CloudflareHostBindings
  executionCtx: ExecutionContext
  /**
   * Map Worker secret binding names to values (e.g. from `env` in the fetch handler).
   * Prefer this over `bindings.secrets` when using wrangler `vars` / secrets.
   */
  secretValues?: Record<string, string | undefined>
}

/**
 * Builds a {@link HostRuntime} from Cloudflare KV + `waitUntil`, without importing Worker types into worker-core.
 */
export function createCloudflareHostRuntime(options: CloudflareHostOptions): HostRuntime {
  const kv = kvNamespaceAdapter(options.bindings.kv)
  const staticSecrets = options.bindings.secrets ?? {}
  const secretValues = options.secretValues ?? {}

  return {
    kv,
    geoCountry(request) {
      return request.headers.get('cf-ipcountry')
    },
    scheduleBackground(task) {
      options.executionCtx.waitUntil(Promise.resolve(task()))
    },
    getSecret(name) {
      return secretValues[name] ?? staticSecrets[name]
    },
    async fetchOutbound(binding, input, init) {
      const transport = options.bindings.outbound?.[binding]
      if (!transport) return fetch(input, init)
      return transport.fetch(input, init)
    },
    botScore(request) {
      // Cloudflare Bot Management score (Enterprise / Super Bot Fight Mode).
      // Absent on plans without bot management — the port then returns null
      // and the community troll-shield relies on UA/header heuristics only.
      const cf = (request as Request & { cf?: { botManagement?: { score?: number } } }).cf
      const score = cf?.botManagement?.score
      return typeof score === 'number' && Number.isFinite(score) ? score : null
    }
  }
}
