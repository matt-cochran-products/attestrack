# Dependency notes

Decisions that pin or hold a dependency below its latest release, with the
reasoning. Re-evaluate each entry when its stated condition changes.

## wrangler held at 4.86.x (node 20 floor)

**Held:** `wrangler ~4.86.0` (packages/deploy, e2e) instead of latest 4.x
(4.114.0 at the time of the 2026-07 dependency sweep).

**Why:** wrangler 4.87.0 raised `engines.node` from `>=20.3.0` to `>=22.0.0`.
This repo targets node 20 (`engines.node >= 20` in the root package.json; every
CI workflow pins `node-version: 20`). 4.86.0 is the last wrangler release whose
engines allow node 20.

**Coupled pins that follow from it:**

- `@cloudflare/vitest-pool-workers` is pinned `0.15.1` — the release that
  bundles exactly `wrangler 4.86.0` + `miniflare 4.20260426.0` (both still
  node-20 compatible; miniflare dropped node 20 at `4.20260430.0`). The
  pool-workers 0.16+ line bundles wrangler >=4.88 (node 22 only).
- The tilde range (`~4.86.0`, not `^4.86.0`) is deliberate: a caret would
  resolve to 4.114.x and silently break node 20 installs.
- Two undici advisories (GHSA-vmh5-mc38-953g, GHSA-hm92-r4w5-c3mj, both
  SOCKS5-proxy-related, deploy-time CLI reach only) are fixed in undici 7.28.0,
  which miniflare only picks up in the wrangler >=4.87 line. They are
  allowlisted in `scripts/audit-gate.mjs` with rationale until then.

**Unblock condition:** when the repo raises its node floor to 22 (engines +
all workflow `node-version` pins), move wrangler to latest 4.x, bump
`@cloudflare/vitest-pool-workers` to the current 0.18+ line, and delete the two
undici allowlist entries.

Note: `@cloudflare/vitest-pool-workers` 0.13+ (the vitest 4 line) replaced
`defineWorkersConfig`/`test.poolOptions.workers` with the `cloudflareTest()`
Vite plugin (see packages/worker-core/vitest.workers.config.ts) and **removed
per-test isolated storage** — KV state now persists across tests within a file,
so the workerd suite wipes the namespace in a `beforeEach`.

## size-limit held at 11.x (node 20 floor)

**Held:** `size-limit` + `@size-limit/preset-small-lib` at `^11.2.0`
(packages/consent-js) instead of the 13.0.1 that the 2026-07 sweep first tried.

**Why:** size-limit 13 imports `glob` from `node:fs/promises`, which only exists
on **node 22+**. On node 20 (this repo's target) the `size-check` gate throws
`SyntaxError: The requested module 'node:fs/promises' does not provide an export
named 'glob'` — it passes on a newer local node but fails in CI (node 20). 11.x
uses its own glob and is node-20 clean. Same node-20 constraint as the wrangler
hold-back above.

**Unblock condition:** when the repo raises its node floor to 22, move
`size-limit`/`@size-limit/preset-small-lib` to latest (13.x).

## react-router-dom at 7.x with an allowlisted advisory

`react-router-dom 7.18.1` (latest; no 7.x patch exists) is subject to
GHSA-qwww-vcr4-c8h2 (RSC-mode CSRF), first patched in `react-router 8.3.0` — a
next major with no `react-router-dom@8` package. The portal is a client-only
Vite SPA (BrowserRouter; no SSR, no RSC, no server actions), so the vulnerable
server-mode path never executes. Allowlisted in `scripts/audit-gate.mjs`;
revisit on a react-router 8 migration.
