# Test strategy — Attestrack OSS

## Layers

| Layer | Location | Proves |
|-------|----------|--------|
| **Unit** | `packages/sdk`, `schema`, `strategies` | Pure logic, Zod, strategy behavior in isolation |
| **Worker contract** | `packages/worker-core/__tests__/contract/*.contract.test.ts` | HTTP + portal JSON + error codes via `createAttestrackFetchHandler` / public SDK test utilities |
| **Deploy contract** | `packages/deploy/__tests__` | Templates, KV seed, scripted CLI harness |
| **Portal contract** | `packages/portal-community/src/**/*.contract.test.ts` | Client prefix alignment, API base / stub rules |
| **E2E** | `e2e/` | Smoke: health + tracking ingest (extend with journey tags later) |

**Rule:** Do not duplicate Worker HTTP assertions inside portal RTL tests. Portal tests cover UI and client wiring; Worker contract tests cover status codes and JSON error shapes.

---

## Naming

- `*.contract.test.ts` — Boundary / HTTP / cross-package behavioral promises tied to [REPO-SPEC-OSS.md](REPO-SPEC-OSS.md).
- `*.test.ts` — Unit and component tests.

---

## Traceability to specs

When a behavior is **OSS** per [OSS-SCOPE-MATRIX.md](OSS-SCOPE-MATRIX.md), prefer **describe** / **it** titles that reference `INV-B-*` or `CLI.*` / `PORTAL.*` where a single test maps cleanly. Do not invent numeric SLAs.

---

## Scaffolding exit criteria (before large feature PRs)

1. [OSS-SCOPE-MATRIX.md](OSS-SCOPE-MATRIX.md) Tier 1 reflects the intended OSS slice for the change.
2. [REPO-SPEC-OSS.md](REPO-SPEC-OSS.md) updated if routes, KV keys, or JSON errors change.
3. New or changed HTTP behavior has a **contract** test under `worker-core/__tests__/contract/` (or expanded e2e with justification).
4. `pnpm route-contract-check` passes if `oss-http-contract.json` changed.

---

## Invariants (examples)

- **INV-B-14 (partial today):** Explore SQL gate — tests in `explore-proxy.contract.test.ts`.
- **INV-B-15 / INV-B-17:** Add dedicated contract files when implemented.

---

## Playwright (future)

Tag scenarios with journey stages (e.g. `Stage4-shadow`) when adding full USER-JOURNEY coverage; smoke stays minimal.
