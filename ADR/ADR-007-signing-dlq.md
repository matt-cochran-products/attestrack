# ADR-007: 500ms Signing Timeout + DLQ

**Status:** Accepted
**Date:** 2026-03-24
**Closes:** Q7 (Architecture Assessment)

## Context

Architecture Assessment Q7 asks what happens when the signing service is unavailable. The FMECA (FM-RT-02) recommended degradation to unsigned evidence with a 3-second timeout. The revised analysis tightens the timeout and adds a Dead Letter Queue (DLQ) for retry.

## Decision

500ms signing timeout. On timeout, the Worker returns HTTP 202 (accepted, processing deferred). The consent-log entry is written immediately (it doesn't depend on signing). The signing request is placed in a localStorage-based Dead Letter Queue (DLQ) in the browser with exponential backoff (5 retries, base interval 30s, max interval 5 minutes). Evidence is created when signing succeeds on retry.

Key design points:

- 500ms timeout (not 3s) -- consent events should not wait 3 seconds for signing
- Worker returns 202 immediately -- user experience is never blocked
- DLQ in localStorage: `dlq.ts` component in **consent-runtime** (licensed bundle; ~1kb, within size budget)
- DLQ entries: `{signing_request, retry_count, next_retry_at, created_at}`
- 5 retries with exponential backoff: 30s, 60s, 120s, 240s, 300s
- After 5 failed retries: entry marked `signing_failed_permanent: true` in consent-log, alert generated
- New evidence entry fields: `delayed_signing: true` (signed on retry), `signing_failed_permanent: true` (gave up)

## Consequences

### Positive

- User never waits more than 500ms for signing. 202 response is fast.
- DLQ recovers from transient signing service outages without data loss.
- Consent-log is always written immediately -- operational record is unaffected by signing availability.

### Negative

- ~1kb added to consent-runtime for dlq.ts (within bundle budget).
- DLQ in localStorage means entries are lost if user clears storage before retry completes.

### Neutral

- `signing_failed_permanent` entries represent a small percentage of total events during outages -- acceptable data quality degradation.

## Structural Assertions

1. "When the signing service does not respond within 500ms, the Worker SHALL return HTTP 202 and queue the signing request to the DLQ."
2. "When a signing request is queued to the DLQ, consent-log SHALL be written immediately with `signing_pending: true`."
3. "When the DLQ retries a signing request and succeeds, a signed evidence entry SHALL be created with `delayed_signing: true`."
4. "When the DLQ exhausts all 5 retries, the consent-log entry SHALL be updated with `signing_failed_permanent: true` and an alert SHALL be generated."
5. "When the DLQ retries a signing request, it SHALL use exponential backoff: 30s, 60s, 120s, 240s, 300s."
6. "When `dlq.ts` is included in consent-runtime, the total bundle size SHALL remain within the published size budget."
7. "When a signed evidence entry is created via DLQ retry (`delayed_signing: true`), it SHALL be linked to the original consent-log entry by `session_id`."

## Spec Changes Required

*(Paths below are in the **attestrue-premium** licensed documentation / EARS tree unless noted.)*

- **`specs/consent-runtime/STRUCTURE.md`:** Add `dlq.ts` component, DLQ assertions (~6 assertions), note bundle budget impact
- **`specs/worker-core/STRUCTURE.md`:** Update signing timeout to 500ms, HTTP 202
- **`specs/strategies/STRUCTURE.md`:** Add `signing_dlq_delivered` event_type
- **`specs/evidence-merkle/STRUCTURE.md`** (module EM-, historical directory name): Add `delayed_signing`, `signing_failed_permanent` fields; remain aligned with **`attestrue-premium/docs/CONSENT-EVIDENCE-TRUST-CHAIN-SPEC.md`** (CETS v1.1) for the witnessed path
- **`specs/consent-lifecycle/STRUCTURE.md`:** Cross-reference DLQ retry interaction with denial permanence (Invariant 4)
- **`specs/invariants/STRUCTURE.md`:** Clarify Invariant 2 with DLQ behavior
- **`specs/ARCHITECTURE-ASSESSMENT.md`:** Close Q7
- **`specs/FMECA-ANALYSIS.md`:** Update FM-RT-02

## FMECA Cross-References

- **FM-RT-02:** Timeout reduced from 3s to 500ms. DLQ replaces immediate degradation to unsigned. Worker returns 202. Signed evidence created on retry. Residual risk unchanged (Low) but mechanism is better specified.
