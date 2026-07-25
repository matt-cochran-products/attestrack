# ADR-011: KV-Only Consent Event Storage (No D1/R2 in OSS v1)

**Status:** Accepted
**Date:** 2026-07-25

## Context

Early scaffolding and specs referenced Cloudflare D1 and R2 as deployment resources (BEHAVORIAL-SPEC CLI.6 "Worker, KV, D1, R2, Pages"; USER-JOURNEY Stage 3 "Resource creation (Worker, KV, D1, R2)"). In the actual codebase, neither is used:

- `packages/deploy/src/d1-schema.sql` was a two-line `-- TODO: define schema` placeholder; nothing imported or shipped it.
- The deploy CLI (`packages/deploy/src/apply-cloudflare.ts`, `index.ts`) creates a **Worker, one KV namespace, and an optional Pages project** — no D1 database, no R2 bucket. `r2-setup.ts` only writes an informational `R2-OPTIONAL.md` into the scaffold (R2 is relevant only to licensed extensions).
- `packages/host-contracts` exposes KV, geo, secrets, and `scheduleBackground` ports — there are no D1/R2 host ports.
- Consent event records (`ConsentEventRecordV1`) are written to KV by the consent-log strategy (`packages/strategies/src/mandatory/consent-log.ts`) with an operator-configurable TTL (site config `consentEventTtlSeconds`, default `DEFAULT_CONSENT_EVENT_TTL_SECONDS` = 90 days, `packages/types/src/consent-event-record.ts`).

Shipping a public repo whose specs promise D1/R2 while the code never touches them is a credibility bug (production plan §1.4 #5). A decision was needed before Phases 2–3 hardened the consent path.

## Decision

**Cut D1 and R2 from OSS v1. Consent event storage is KV-only.**

1. Delete `packages/deploy/src/d1-schema.sql` (done in this change).
2. Consent event records stay in KV under `attestrack:consent_event:<id>` (`KV_KEY_CONSENT_EVENT_PREFIX`, `packages/types/src/kv-keys.ts`) with an **operator-configurable TTL** (site config `consentEventTtlSeconds`; default 90 days).
3. CLI.6 scope is amended: the CLI creates **Worker, KV, and Pages** resources in the user's own Cloudflare account. D1/R2 are not created (see the amendment note in BEHAVORIAL-SPEC CLI.6).
4. R2 remains an *optional, licensed-extension-era* concern; the deploy scaffold keeps the informational `R2-OPTIONAL.md` note only.

### Honest limitation (documented, not hidden)

KV-only consent event storage means, for the community tier:

- Records **expire** at the configured TTL; there is no durable, append-only audit log.
- KV offers no querying — listing/browsing consent events (the CE.* portal surfaces) is not practical at scale, and OSS does not ship a consent-event browser.
- Records are **unsigned self-attested operational records** (ADR-002); witnessed, durable evidence (Proof / trust chain) is the licensed product.

Operators who need longer retention raise `consentEventTtlSeconds`; operators who need durable queryable evidence need the licensed tier or their own export.

## Consequences

### Positive
- Repo stops promising resources it never provisions; `grep -ri TODO` no longer finds a stub schema file.
- Deploy stays one-namespace simple; no migration story needed for v1.
- Phase 2 consent-path work (TTL configurability, `ioaAttested`, mechanism/mode recording) landed against KV with contract tests.

### Negative
- No consent-event listing in the community portal (CE.* stays out of OSS scope).
- Revisiting D1 later (e.g. for a queryable consent-event log) will be a new ADR plus a host-port addition — deliberately deferred, not precluded.

### Neutral
- Licensed extensions may use their own storage; that is out of scope for this repo.

## Structural Assertions

1. `packages/deploy` SHALL NOT contain a D1 schema file or create D1/R2 resources while this ADR stands.
2. Consent event records SHALL be written to KV with `expirationTtl` = site config `consentEventTtlSeconds` (default 90 days).
3. Docs describing deploy-time resource creation SHALL list Worker, KV, and Pages only.

## FMECA Cross-References

No direct FMECA failure mode. Mitigates the "half-built optics" launch risk (production plan §1.4 #5).
