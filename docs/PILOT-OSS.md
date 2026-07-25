# OSS self-pilot checklist

Use this when you want to run **Attestrack end-to-end** on **your** Cloudflare account (no licensed extensions required).

## Prerequisites

- Node.js 20+
- A Cloudflare account; install the [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) or rely on the `wrangler` dependency pulled in by `@attestrack/deploy`
- Log in once: `npx wrangler login`, or set `CLOUDFLARE_API_TOKEN` with **Workers**, **Workers KV**, and **Cloudflare Pages** permissions
- Dev mode only: pnpm 9 (`packageManager` in the repo root `package.json`)

## One-command deploy (preferred)

**Standalone (published packages)** — from any empty directory:

```bash
npx @attestrack/deploy
```

> Pre-launch note: this works once the `@attestrack/*` packages are on npm (first
> publish is a maintainer step — see [RELEASING.md](RELEASING.md)). Until then use dev mode below.

The scaffold's `package.json` references the published `@attestrack/worker-core`,
`@attestrack/host-cloudflare-worker`, and `@attestrack/strategies` (npm `latest`;
pin with `ATTESTRACK_DEPLOY_PACKAGE_RANGE=^x.y.z`). The portal build needs the
repository sources, so in standalone mode the CLI shallow-clones
`github.com/matt-cochran/attestrack` into `attestrack-deploy/.portal-src` and
builds there (requires `git`; use `--skip-portal` to deploy the Worker only).

**Dev mode (from a repo clone)** — `file:` deps into your working tree:

```bash
git clone https://github.com/matt-cochran/attestrack.git
cd attestrack
pnpm install
pnpm build
pnpm --filter @attestrack/deploy exec attestrack-deploy
```

The CLI runs numbered steps (you always see `step k/N`):

1. Verify Wrangler authentication (`wrangler whoami`)
2. Create a **new** KV namespace — **or**, if `attestrack-deploy/wrangler.toml` already exists, choose **reuse** (same KV: refresh files, re-seed, redeploy) per the prompt (BEH CLI.11). Non-interactive: pass `--reuse-kv`.
3. Write scaffold files. **On a re-run this shows a diff** of `wrangler.toml` and the KV seed before anything is applied, and asks for confirmation
4. Run `npm install` in `attestrack-deploy`
5. Seed KV (including `attestrack:enabled_strategies` — default analytics: `clickhouse`, `tinybird`, `drift-detection`; add ad-network ids when you set those secrets). Skip with `--skip-seed` to keep config you edited via the portal
6. Prompt for `CONSENT_TOKEN_SECRET` via Wrangler (masked; the CLI never echoes or logs credential values)
7. Run `wrangler deploy`
8. Unless you pass `--skip-portal`, build the portal with `VITE_ATTESTRACK_API_BASE_URL` set to your Worker URL, then `wrangler pages deploy`
9. Verify: poll Worker `/health`, then your custom-domain route (DNS can take up to 24 h — the CLI says so instead of failing)

Failed steps that are recoverable (network, auth, transient Cloudflare errors) offer a retry prompt instead of aborting (BEH CLI.4).

**Flags:**

- `--scaffold-only` — write files only (no Wrangler / npm apply)
- `--skip-portal` — Worker only; no Pages build or deploy
- `--skip-seed` — do not re-write KV seed keys (re-runs; keeps portal-edited config)
- `--reuse-kv` — if `attestrack-deploy/wrangler.toml` already lists a real KV id, reuse it (no `kv namespace create`); for scripted/API use `reuseExistingScaffold` in options
- `--dry-run` — print every step without touching Cloudflare (also `ATTESTRACK_DEPLOY_DRY_RUN=1`)
- `--help` — full usage

### Re-running deploy (CLI.11)

A second run from the same directory sees the existing `attestrack-deploy/wrangler.toml`. Answer **Y** to reuse the KV namespace so you do not accumulate orphan namespaces; answer **n** to create a **new** namespace (fresh KV). Before applying, the CLI prints the `wrangler.toml` line diff and the KV-seed key diff. **Re-seeding overwrites the seeded KV keys** — if you changed site config or consent config via the portal, re-run with `--skip-seed`.

## Verify the deployment (`verify`)

```bash
npx @attestrack/deploy verify
```

Defaults come from `attestrack-deploy/deploy-state.json` (written on deploy); override with `--worker-url`, `--domain`, `--portal-url`, `--site-id`. It checks:

1. `GET <worker>/health` → `200 ok`
2. `GET https://<your-domain>/health` — polls the custom-domain route; a miss is reported as **pending** ("wait up to 24 h"), not failure
3. The portal URL **302-redirects to Cloudflare Access** — a `200` means the portal is PUBLIC and the CLI warns loudly
4. `POST /__attestrack__/consent/commit` returns `{ token }` (proves `CONSENT_TOKEN_SECRET` is configured)

Exit code is non-zero when the Worker or consent commit fails; DNS-pending and portal warnings do not fail the command.

## Cloudflare Access on the portal (production)

The Pages URL is **public** until you protect it. Access-app creation stays **manual by design**: automating it needs a Zero Trust API token and IdP assumptions we will not guess at — instead the checklist below is *verified* by `npx @attestrack/deploy verify` (step 3 above), so you cannot silently skip it.

**Protect the Worker's portal API too.** The portal API (`/__attestrack__/portal/v1/*` on the **Worker** hostname) has no built-in authentication (PORTAL.1): without protection it is a world-readable and world-writable config API — strategy toggles, trusted domains (the CORS allowlist), saved queries, and warehouse queries via Explore. Put Access in front of those Worker paths, or (defense-in-depth, e.g. when you cannot use Access) set the Worker secret `PORTAL_API_SHARED_SECRET`:

```bash
wrangler secret put PORTAL_API_SHARED_SECRET   # any long random value
```

With the secret set, every portal API request must send it in the `x-attestrack-portal-secret` header or receives `401 portal_unauthorized`; the public consent/tracking routes are unaffected. Note the community portal SPA does not send this header — never embed the secret in the public SPA bundle; use it from API clients or a proxy that injects the header. Full analysis: [THREAT-MODEL.md](THREAT-MODEL.md).

The deploy completion banner repeats this reminder.

Checklist:

1. Cloudflare Zero Trust → **Access → Applications → Add an application → Self-hosted**
2. Application domain: your portal hostname (the `*.pages.dev` URL and/or your custom portal domain)
3. Add a policy restricted to your IdP group or an email allowlist (deny by default)
4. Save, then confirm: `npx @attestrack/deploy verify` must report *"portal redirects to Cloudflare Access (protected)"*
5. Repeat for any custom domain you later attach to the portal

Do not treat the operator portal as safe without authentication. The deploy completion banner repeats this reminder.

## Verify the Worker (manual spot checks)

1. `GET https://<your-worker>/health` → `200` body `ok`
2. `POST /t/event` with a valid `trackingEventV1` body → `200` JSON acceptance (see [REPO-SPEC-OSS.md](REPO-SPEC-OSS.md))
3. `POST /__attestrack__/consent/commit` with a valid body → `{ token }` when `CONSENT_TOKEN_SECRET` is set

## Verify the portal

1. Open the Pages URL; the shell should show **Live worker** when `VITE_ATTESTRACK_API_BASE_URL` was set at build time
2. Site config and mode changes hit `/__attestrack__/portal/v1/...` on the Worker (see [REPO-SPEC-OSS.md](REPO-SPEC-OSS.md))

## Consent script and Explore

1. Mount `@attestrack/consent-js` (or your integration) on a test property pointing at your Worker
2. Configure warehouse secrets (`TINYBIRD_TOKEN` and/or ClickHouse secrets) for **Explore**; saved queries live in KV under `attestrack:portal:saved_queries`

## Dashboard, destinations, and logs (live data)

On a fresh deploy, once traffic hits `/t/event` the portal **populates itself — no manual KV seeding**:

- **Dashboard** — `eventsToday` (sampled per-UTC-day counter; approximate above 5 000 events/day), drift alerts, and strategy status are computed by the Worker from recorded data
- **Destinations** — per-strategy delivery outcomes (success rate, last event, last error) recorded by every configured sink; endpoints with secrets but no traffic yet honestly show *configured — no deliveries recorded yet*
- **Request Logs** — a bounded per-hour log ring (60 entries/hour, 48 h retention) written on ingest
- **Signal Recovery** — **not measured in v1**: blocker/ITP recovery comparisons require a client beacon Attestrack does not ship yet, so the view says so instead of estimating; the bot-filter counter (troll-shield heuristics) is the only real figure

Counters are best-effort KV writes — treat them as approximate lower bounds, not billing-grade numbers. See [REPO-SPEC-OSS.md](REPO-SPEC-OSS.md) → *Portal observability data sources* for the exact contract.

## Updates, migrations & rollback

### KV key versioning policy

- **Keys are additive.** New releases may introduce new `attestrack:*` keys; they never repurpose or change the meaning of an existing key. The registry lives in `packages/types/src/kv-keys.ts`.
- **Versioned values carry a `v` field.** JSON values that can evolve embed an explicit version (e.g. the consent token payload is `v: 1`); readers treat unknown versions as absent rather than mis-parsing them.
- **Readers tolerate missing keys.** Every Worker read of a KV key falls back to a safe default when the key is absent, so a Worker one release ahead of (or behind) the seed still runs.
- Consequence: **seed data written by release N is compatible with Worker release N−1 and N+1.** Upgrades are "deploy new Worker, optionally re-seed"; there are no destructive KV migrations in v1 (ADR-011 KV-only).

### Upgrading a deployment

1. Re-run the deploy CLI from the same directory and choose **reuse** (or `--reuse-kv`)
2. Review the printed diff (CLI.11); use `--skip-seed` to keep portal-edited config
3. The Worker is redeployed in place; the portal is rebuilt and redeployed to the same Pages project

### Rolling back

- **Worker:** `npx wrangler rollback` from `attestrack-deploy/` reverts to the previous Worker version in your account (or `npx wrangler deployments list` + `npx wrangler rollback [version-id]`).
- **KV compatibility statement:** because keys are additive and readers default missing keys, a rolled-back Worker keeps working against KV seeded by the newer release. New keys the old Worker does not know about are simply ignored. If you re-seeded with `--skip-seed` omitted and want the previous config values back, restore them via the portal or `npx wrangler kv key put`.
- **Portal:** Cloudflare Pages keeps prior deployments — activate the previous deployment in the Pages dashboard (or `wrangler pages deployment list`).
- **Secrets** are never touched by rollback; `CONSENT_TOKEN_SECRET` rotation uses `CONSENT_TOKEN_SECRET_PREVIOUS` (keyring) so tokens issued before rotation stay valid until TTL.

## Manual fallback

If you use `--scaffold-only` or work offline, follow `attestrack-deploy/README.md` for `wrangler secret put`, `kv bulk put`, and `wrangler deploy` by hand.

## Further reading

- [BEHAVORIAL-SPEC.md](BEHAVORIAL-SPEC.md) — product behaviour spec
- [OSS-SCOPE-MATRIX.md](OSS-SCOPE-MATRIX.md) — OSS vs licensed scope
- [REPO-SPEC-OSS.md](REPO-SPEC-OSS.md) — HTTP, KV, and error contracts
- [RELEASING.md](RELEASING.md) — versioning, tags, npm publish (maintainers)
