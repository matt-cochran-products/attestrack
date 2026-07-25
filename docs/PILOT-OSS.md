# OSS self-pilot checklist

Use this when you want to run **Attestrack end-to-end** on **your** Cloudflare account from this repository (no licensed extensions required).

## Prerequisites

- Node.js 20+
- pnpm 9 (`packageManager` in the repo root `package.json`)
- A Cloudflare account; install the [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) or rely on the `wrangler` dependency pulled in by `@attestrack/deploy`
- Log in once: `npx wrangler login`, or set `CLOUDFLARE_API_TOKEN` with **Workers**, **Workers KV**, and **Cloudflare Pages** permissions

## One-command deploy (preferred)

From the **repository root** (so `packages/worker-core` exists):

```bash
pnpm install
pnpm --filter @attestrack/deploy build
pnpm --filter @attestrack/deploy exec attestrack-deploy
```

Or after publishing: `npx @attestrack/deploy` from the same monorepo layout.

The CLI will:

1. Verify Wrangler authentication (`wrangler whoami`)
2. Create a **new** KV namespace and write `attestrack-deploy/wrangler.toml` with its id — **or**, if `attestrack-deploy/wrangler.toml` already exists, choose **reuse** (same KV: refresh files, re-seed, redeploy) per the prompt (BEH CLI.11). Non-interactive: pass `--reuse-kv` to skip creating another namespace when a valid id is already in the file.
3. Generate `package.json` with `file:` dependencies into `worker-core`, `host-cloudflare-worker`, and `strategies`
4. Run `npm install` in `attestrack-deploy`
5. Seed KV (including `attestrack:enabled_strategies` — default analytics: `clickhouse`, `tinybird`, `drift-detection`; add ad-network ids when you set those secrets)
6. Prompt for `CONSENT_TOKEN_SECRET` via Wrangler (masked)
7. Run `wrangler deploy`
8. Unless you pass `--skip-portal`, run `pnpm run build` in `packages/portal-community` with `VITE_ATTESTRACK_API_BASE_URL` set to your Worker URL, then `wrangler pages deploy`

**Flags:**

- `--scaffold-only` — write files only (no Wrangler / npm apply)
- `--skip-portal` — Worker only; no Pages build or deploy
- `--reuse-kv` — if `attestrack-deploy/wrangler.toml` already lists a real KV id, reuse it (no `kv namespace create`); for scripted/API use `reuseExistingScaffold` in options

### Re-running deploy (CLI.11)

A second run from the same repo directory will see the existing `attestrack-deploy/wrangler.toml`. Answer **Y** to reuse the KV namespace so you do not accumulate orphan namespaces. Answer **n** to create a **new** namespace (fresh KV) while keeping the same folder layout.

**Important:** Full apply requires this **monorepo**: Worker and portal packages are not published as standalone npm apps; paths are resolved with `file:` dependencies.

## Cloudflare Access on the portal (production)

The Pages URL is **public** until you protect it. In Cloudflare Zero Trust, create an **Access application** for your portal hostname and restrict it to your IdP or email allowlist. Do not treat the operator portal as safe without authentication.

The deploy completion banner repeats this reminder.

## Verify the Worker

1. `GET https://<your-worker>/health` → `200` body `ok`
2. `POST /t/event` with a valid `trackingEventV1` body → `200` JSON acceptance (see [REPO-SPEC-OSS.md](REPO-SPEC-OSS.md))
3. `POST /__attestrack__/consent/commit` with a valid body → `{ token }` when `CONSENT_TOKEN_SECRET` is set

## Verify the portal

1. Open the Pages URL; the shell should show **Live worker** when `VITE_ATTESTRACK_API_BASE_URL` was set at build time
2. Site config and mode changes hit `/__attestrack__/portal/v1/...` on the Worker (see [REPO-SPEC-OSS.md](REPO-SPEC-OSS.md))

## Consent script and Explore

1. Mount `@attestrack/consent-js` (or your integration) on a test property pointing at your Worker
2. Configure warehouse secrets (`TINYBIRD_TOKEN` and/or ClickHouse secrets) for **Explore**; saved queries live in KV under `attestrack:portal:saved_queries`

## Dashboard metrics (expectations)

OSS dashboard cards that read **KV** (for example `attestrack:portal:dashboard`) may show **stub or operator-seeded** values until you add automation. This is expected for the community pilot; do not assume every chart reflects live warehouse rollups without additional Worker or ETL work.

## Manual fallback

If you use `--scaffold-only` or work offline, follow `attestrack-deploy/README.md` for `wrangler secret put`, `kv bulk put`, and `wrangler deploy` by hand.

## Further reading

- [BEHAVORIAL-SPEC.md](BEHAVORIAL-SPEC.md) — product behaviour spec
- [OSS-SCOPE-MATRIX.md](OSS-SCOPE-MATRIX.md) — OSS vs licensed scope
- [REPO-SPEC-OSS.md](REPO-SPEC-OSS.md) — HTTP, KV, and error contracts
