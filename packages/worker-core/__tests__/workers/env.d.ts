/// <reference types="@cloudflare/workers-types" />

declare module 'cloudflare:test' {
  /** Bindings declared in vitest.workers.config.ts (miniflare.kvNamespaces). */
  interface ProvidedEnv {
    ATTESTRACK_KV: KVNamespace
  }
}
