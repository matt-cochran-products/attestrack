# Releasing & publishing (`@attestrack/*`)

How Attestrack packages get versioned, tagged, and published to npm (plan P5.4).

## What is published

Eight packages, released in lockstep from this repository (all MIT, `publishConfig.access: public`):

| Package | Dir | Why it ships |
|---|---|---|
| `@attestrack/types` | `packages/types` | public contracts (zero deps) |
| `@attestrack/schema` | `packages/schema` | Zod validation + warehouse DDL |
| `@attestrack/sdk` | `packages/sdk` | strategy-author kit, consent token |
| `@attestrack/host-contracts` | `packages/host-contracts` | host port types |
| `@attestrack/host-cloudflare-worker` | `packages/host-cloudflare-worker` | Cloudflare `HostRuntime` adapter |
| `@attestrack/strategies` | `packages/strategies` | bundled strategies |
| `@attestrack/worker-core` | `packages/worker-core` | Worker fetch handler (embeds the built consent-js bundle) |
| `@attestrack/deploy` | `packages/deploy` | the `npx @attestrack/deploy` CLI |

**Not published:** `consent-js` (embedded into `worker-core` at build time), `portal-community` (built and deployed customer-side — INV-B-11: no hosted portal), `e2e`, `tooling/*`, `deploy/local`.

The standalone deploy scaffold depends on `@attestrack/worker-core`, `@attestrack/host-cloudflare-worker`, and `@attestrack/strategies` from npm — publishing those three (plus their transitive deps `types`, `schema`, `sdk`, `host-contracts`) is what makes `npx @attestrack/deploy` work from an empty directory (P5.1).

## Release flow

1. Conventional commits land on `main`.
2. `release-please.yml` maintains a release PR per the **per-package** manifest
   (`release-please-config.json` + `.release-please-manifest.json`); the
   `node-workspace` plugin cascades bumps into dependent packages so the
   published set stays mutually compatible (internal deps are exact-pinned at
   publish time from `workspace:*`).
3. Merging the release PR creates one tag per released package: `<component>-v<version>`
   (e.g. `worker-core-v0.1.0`) and a per-package `CHANGELOG.md`.
4. Each tag triggers `publish.yml`, which builds the workspace and runs
   `pnpm --filter @attestrack/<component> publish --access public --no-git-checks`
   with `NPM_CONFIG_PROVENANCE=true` (npm provenance; the job has `id-token: write`).

## Maintainer-only setup (live credentials — cannot be verified in CI ahead of time)

These steps have **not** been executed yet; nothing is on npm today. They are the
exact remaining actions:

1. Create the npm org/scope **`@attestrack`** and enable 2FA (P7.4 hygiene).
2. Create an **automation token** and save it as the `NPM_TOKEN` repository secret —
   or configure [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers)
   for `matt-cochran/attestrack` + `publish.yml`, then delete the `NODE_AUTH_TOKEN`
   line from the workflow.
3. First publish rehearsal without tags: *Actions → Publish → Run workflow* with
   `component: types`, `dry_run: true` (repeat per package), then run once with
   `dry_run: false` — or cut the first release PR and let the tags drive it.
   For a soft launch, add `--tag next` to the publish command and promote with
   `npm dist-tag add <pkg>@<version> latest` after smoke-testing
   `npx @attestrack/deploy@next`.

## Dry-run proof (2026-07-25, no credentials)

`pnpm build` then `pnpm --filter <pkg> publish --dry-run --no-git-checks` succeeded
for all eight packages (tarballs assembled, `files: ["dist"]` respected,
`workspace:*` rewritten to concrete versions — verified via `pnpm pack` on
`worker-core`, whose manifest showed `"@attestrack/sdk": "0.0.0"` etc.):

| Package | Tarball | Unpacked |
|---|---|---|
| types | 14.4 kB | 41.0 kB |
| schema | 15.2 kB | 63.5 kB |
| sdk | 16.2 kB | 52.2 kB |
| host-contracts | 2.1 kB | 3.8 kB |
| host-cloudflare-worker | 2.6 kB | 5.8 kB |
| strategies | 19.9 kB | 79.0 kB |
| worker-core | 33.2 kB | 128.6 kB |
| deploy | 33.3 kB | 118.2 kB |

The only unverifiable-without-credentials part is the actual `npm publish`
(auth + provenance attestation upload) — that is the maintainer step above.

## Rollback of a bad release

- npm: `npm deprecate @attestrack/<pkg>@<version> "reason"` (or `npm unpublish`
  within 72 h for a broken artifact); the standalone scaffold tracks the `latest`
  dist-tag, so re-pointing `latest` is sufficient.
- Deployed workers are rolled back customer-side with `wrangler rollback` —
  see `docs/PILOT-OSS.md` → "Updates, migrations & rollback".
