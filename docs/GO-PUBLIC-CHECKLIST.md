# Go-public readiness checklist (§8 of the production plan)

**Purpose:** the truthful, item-by-item status of the go-public bar in
`ATTESTRACK-PRODUCTION-PLAN.md` §8. Pre-launch working document — update it whenever an
item moves; the repo does **not** flip public until every row is DONE or explicitly
accepted by the maintainer.

**Status legend:** **DONE** (merged, cited) · **OPEN** (work remains; owner noted) ·
**MAINTAINER** (requires live credentials or an irreversible action only the maintainer
can take).

*Last audited: 2026-07-25 (P8.6, branch `feature/p8-docs`). PR numbers refer to this
repository.*

---

## Core paths — no stubs

| Item | Status | Evidence / remaining work |
|---|---|---|
| §1.2 defect 1 — cookie/CORS topology | **DONE** (P2, PR #8) | Worker sets `at_consent` via `Set-Cookie` with `Domain` from site config (ADR-012); explicit CORS allowlist. Regression: `packages/worker-core/__tests__/contract/cors-cookie-consentjs.contract.test.ts` |
| §1.2 defect 2 — mode/mechanism semantics | **DONE** (P2, PR #8) | SHADOW never blocks + would-be decision recorded; opt-out rows honored; GPC per row. Regression: `consent-matrix.contract.test.ts`, `packages/sdk/__tests__/consent-gate.test.ts` |
| §1.2 defect 3 — SQL-gate qualified-name bypass | **DONE** (PR #4, P4.1) | Qualified `db.table` rejected, `default` de-listed; adversarial + hardening suites in `packages/schema/__tests__/explore-sql.test.ts`; nightly Stryker mutation run (PR #7, 89.9%) |
| §1.2 defect 4 — quickstart / `/consent.js` | **DONE** (P0 PR #9, P2 PR #8, P8) | `GET /consent.js` served (embedded IIFE, contract-tested); README identity/clone URL fixed; quickstart re-verified against the tree in P8 |
| `config.ts` / `degraded.ts` implemented or deleted; no "to be implemented"/TODO files | **OPEN** (one small PR) | `config.ts` is fully implemented (P2/P3). `grep -ri "to be implemented\|TODO" packages/` finds exactly two files: `packages/worker-core/src/degraded.ts` and `packages/worker-core/src/policy-server.ts` — both are dead placeholder stubs, **not imported or exported anywhere** → delete both files (verified safe; deletion was blocked by sandbox permissions in the P8 session). `d1-schema.sql` already deleted (ADR-011); `publish.yml` is real (P5.4) |
| `troll-shield` real or removed | **DONE** (P3.4, PR #10) | Honest heuristics + optional host bot score; bots never fire destinations; rows relabeled. `packages/strategies/__tests__/troll-shield.test.ts` |
| Ingest → warehouse against repo-shipped DDL, verified in CI | **OPEN** (Phase 6, in flight) | Column-projection parity with `clickhouse.sql` is unit-tested (`packages/strategies/__tests__/clickhouse.test.ts` — exact column set, JSONEachRow shape); a live ClickHouse-container CI job does not exist yet. Tinybird path is mock-tested only |
| Consent matrix under **workerd** + cross-subdomain browser e2e | **OPEN** (Phase 6, in flight) | The matrix suite exists and passes under Node vitest (`consent-matrix.contract.test.ts`); current e2e is Playwright against a Node dev server (`e2e/`), not workerd; no cross-subdomain browser e2e yet |
| Portal live data on fresh deploy; stub views labeled/de-scoped | **DONE** (P3, PR #10; P4, PR #12) | Dashboard/destinations/logs computed from traffic (`portal-observability.contract.test.ts`; route-contract gate forbids seeded dashboard); `/signal*` honestly de-scoped (`requires_beacon`); stub-vs-live chip in the portal shell; accounting in `OSS-SCOPE-MATRIX.md` |

## Gates green

| Item | Status | Evidence / remaining work |
|---|---|---|
| typecheck/lint/test/build + route-contract + boundary + size + egress + audit gates green | **DONE** (recurring) | `ci.yml` runs all of them on PR + push; re-verified green on this branch 2026-07-25 |
| Coverage thresholds + a11y gates in CI | **OPEN** (Phase 6, in flight) | Not present in `ci.yml` yet |
| Secret-echo test | **DONE** (P5) | `packages/deploy/__tests__/secret-masking.test.ts` (CLI output/diff masking, INV-B-10); worker never logs secret values (`egress-check` + threat model review) |
| All gates **required on branch protection** | **MAINTAINER** | GitHub → Settings → Branches: require the CI + e2e checks on `main`/`dev`. Cannot be done from a working tree |
| E2E (workerd + Playwright browser) green in CI | **OPEN** (Phase 6, in flight) | Node-server Playwright smoke exists (`e2e/smoke.spec.ts`, `e2e.yml`); workerd + real-browser cross-subdomain e2e pending |
| `npx @attestrack/deploy` standalone from published packages; `publish.yml` proven (`next` dist-tag dry run) | **MAINTAINER** | Nothing is on npm (all packages 0.0.0). Local `publish --dry-run` proof for all 8 packages is recorded in `docs/RELEASING.md` (2026-07-25). Remaining: create `@attestrack` npm org + 2FA, `NPM_TOKEN`/trusted publishing, workflow dry-run rehearsal, then `--tag next` smoke of `npx @attestrack/deploy@next` |

## Trust & docs

| Item | Status | Evidence / remaining work |
|---|---|---|
| Threat model merged; token crypto reviewed; portal authn stance documented; SECURITY.md | **DONE** (P7, PR #11; P0, PR #9) | `docs/THREAT-MODEL.md`; P7.2 hardening + `consent-token-hardening.test.ts`; authn statement in `REPO-SPEC-OSS.md` + `PILOT-OSS.md` + `API-REFERENCE.md`; `SECURITY.md` |
| Full-history secret + boundary scan; history curated if needed | **PART DONE / MAINTAINER** | P8.6 scan results below. Remaining: run **gitleaks** over full history (not installed in the audit environment), then decide history curation |
| README/CLAUDE.md/docs zero false claims; premium links de-linked | **DONE** (P0 PR #9, P8) | Identity fixed (P0); "Miniflare" claim corrected (CLAUDE.md states Node dev server); consent scope per ADR-010; dashboards computed or labeled; sibling links are plain-text citations. Standing launch rule: no chart backed by invented numbers |
| Quickstart re-executed on a clean machine by someone other than the author | **MAINTAINER** | P8 verified every quickstart command exists/parses against the tree; a genuine clean-machine run by a second person is still required |
| Live demo deployment + screencast linked from README | **MAINTAINER** | Storyboard + exact commands ready: `docs/DEMO-SCRIPT.md`; README has the placeholder section |
| LICENSE/notices for new deps (charts stack); CONTRIBUTING + strategy-PR template | **DONE** (P8) | Chart stack licenses checked 2026-07-25: echarts **Apache-2.0**; recharts, @tanstack/react-table, CodeMirror packages **MIT** — all MIT-repo compatible, no notice obligations beyond bundled license texts. `CONTRIBUTING.md` present; community strategy template at `.github/PULL_REQUEST_TEMPLATE/community_strategy.md` |
| OSS-SCOPE-MATRIX Evidence filled for every OSS row | **DONE** (P8) | INV-B-10 evidence added (secret-masking tests); remaining `—` cells are licensed/not-shipped rows by design (Part V evidence chain, INV-B-13) |

---

## P8.6 history-scan results (2026-07-25)

Commands run from a clean checkout of `dev` (56a86f2):

1. **Licensed-sibling repo name** (`attestrue` + `-premium`, spelled without the literal
   here for the same reason `scripts/boundary-check.mjs` builds it from parts):
   `git log -S <that-name> --oneline` → **3 commits** (`afd4fa3` cleanup, `9343634` plan,
   `64e31f2` P0). Per-commit pickaxe file lists show every occurrence past and present is
   confined to the **boundary-documentation files allowlisted by `boundary-check.mjs`**
   (ADR-002/007/008/010, `CONSENT-EVIDENCE-TOKEN-STANDARD.md`, `OSS-SCOPE-MATRIX.md`,
   `REPO-SPEC-OSS.md`, the production plan). **No code file ever contained it.**
2. **Bare sibling name:** `git log -S attestrue --oneline` → 10 commits. Early history
   (Mar 2026 init commits) used the name broadly — 61 files at `7a8663c`, including the
   `@attestrue/` package scope in 50 files, and an Astro marketing `site/` (removed in
   `ea95bb7`). At current HEAD it appears in 26 files, all legitimate (boundary docs, the
   static upgrade-handoff URL constant in `portal.ts`, tests of the `requires_attestrue`
   403 surface).
3. **Premium code:** `packages/merkle` (the ADR-009 forbidden path) has **never existed**
   in history; no licensed/premium source code found in any historical tree.
4. **Secrets:** full-history diff scan (`git log --all -p`) against common credential
   patterns (AWS `AKIA…`, GitHub `ghp_`/`gho_`/`github_pat_`, Slack `xox…`, `sk-…`,
   Google `AIza…`, `npm_…`, PEM private keys, JWTs) → **zero hits**. Credential-assignment
   grep → only the test fixture `'test-secret-32-chars-minimum!!'`. Working-tree secret
   grep → clean.
5. **gitleaks:** **not run** — not installed in the audit environment. Maintainer must
   run `gitleaks git .` (full history) and archive the report before flipping public.

**History-curation recommendation:** no secrets and no premium code are in history; the
residual early-history naming (`@attestrue/` scope, marketing site) is cosmetic and
publicly known (the sibling product is openly marketed under that name). Rewriting is
**optional**: either keep history as-is, or squash everything before P0 (`64e31f2`) into
one init commit if the rename noise matters. Rewriting is irreversible — maintainer's
call.

---

## Irreversible launch actions — maintainer only, in order

Deliberately **not** automated or performed by any agent/PR:

1. Run gitleaks over full history; archive the clean report.
2. Decide and (optionally) execute history curation; force-push only if chosen.
3. Enable branch protection on `main` (and `dev`) with all CI + e2e checks required.
4. Create the npm org `@attestrack` (2FA), configure `NPM_TOKEN`/trusted publishing,
   rehearse `publish.yml` dry-run, first publish under `--tag next`, promote to `latest`
   after `npx @attestrack/deploy@next` smoke-passes.
5. Deploy the live demo property; record the screencast per `docs/DEMO-SCRIPT.md`; embed
   in README; have a second person re-run the quickstart on a clean machine.
6. Flip the repository public.
