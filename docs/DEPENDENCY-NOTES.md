# Dependency notes

Decisions that pin or hold a dependency below its latest release, with the
reasoning. Re-evaluate each entry when its stated condition changes.

> **Node floor: 22.** The repo requires node >=22 (`engines.node` in the root
> package.json; every CI workflow pins `node-version: 22`) since the
> `chore/node-22` bump. Node 20 reached EOL in April 2026.

## Resolved: wrangler hold at 4.86.x (was: node 20 floor)

**Resolved by the node-22 bump (`chore/node-22`).** wrangler was held at
`~4.86.0` because 4.87.0 raised `engines.node` to `>=22.0.0` while this repo
still targeted node 20. With the node floor now at 22:

- `wrangler` is at `^4.114.0` (packages/deploy, e2e).
- `@cloudflare/vitest-pool-workers` moved from the pinned `0.15.1` to `0.18.8`
  (bundles wrangler 4.114.0 + miniflare 4.20260722.0). Kept pinned exact so the
  bundled wrangler/miniflare/workerd stay deterministic.
- `@cloudflare/workers-types` moved to `^5.20260722.1`, matching the workerd
  runtime (1.20260722.1) bundled by wrangler 4.114.0.
- The two undici SOCKS5 advisories (GHSA-vmh5-mc38-953g, GHSA-hm92-r4w5-c3mj)
  are fixed by undici 7.28.0, which miniflare 4.20260722.0 ships; their
  allowlist entries were removed from `scripts/audit-gate.mjs`.

Note: `@cloudflare/vitest-pool-workers` 0.13+ (the vitest 4 line) replaced
`defineWorkersConfig`/`test.poolOptions.workers` with the `cloudflareTest()`
Vite plugin (see packages/worker-core/vitest.workers.config.ts) and **removed
per-test isolated storage** — KV state now persists across tests within a file,
so the workerd suite wipes the namespace in a `beforeEach`. This is unchanged
in the 0.18 line.

## Resolved: size-limit hold at 11.x (was: node 20 floor)

**Resolved by the node-22 bump (`chore/node-22`).** size-limit 13 imports
`glob` from `node:fs/promises`, which only exists on node 22+; on node 20 the
`size-check` gate threw at import time. With the node floor now at 22,
`size-limit` + `@size-limit/preset-small-lib` are at `^13.0.1`
(packages/consent-js).

## react-router-dom at 7.x with an allowlisted advisory

`react-router-dom 7.18.1` (latest; no 7.x patch exists) is subject to
GHSA-qwww-vcr4-c8h2 (RSC-mode CSRF), first patched in `react-router 8.3.0` — a
next major with no `react-router-dom@8` package. The portal is a client-only
Vite SPA (BrowserRouter; no SSR, no RSC, no server actions), so the vulnerable
server-mode path never executes. Allowlisted in `scripts/audit-gate.mjs`;
revisit on a react-router 8 migration.
