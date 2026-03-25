# ADR-006: Content-Addressed CDN Bundles

**Status:** Accepted
**Date:** 2026-03-24
**Closes:** Q6 (Architecture Assessment)

## Context

Architecture Assessment Q6 asks how the CDN publishing pipeline handles rollbacks. The original design has a 1-hour cache TTL, meaning a bad bundle executes for up to 1 hour on every customer's Worker. Cache purge propagation time was unknown.

## Decision

Content-addressed CDN bundles. Strategy bundles are published at `/strategies/v{sha256}.js` (immutable, infinite cache). A `latest.js` pointer file contains the current bundle URL (5-minute TTL). Rollback = re-point `latest.js` to the previous content-addressed URL + Cloudflare Cache Purge API call. Blast radius is 5 minutes (latest.js TTL), not 1 hour.

Implementation:

- Bundle filenames include SHA-256 content hash: `/strategies/v{sha256}.js`
- Content-addressed bundles have `Cache-Control: public, max-age=31536000, immutable` (1 year, immutable -- content never changes for a given hash)
- `latest.js` is a lightweight pointer (JSON: `{url, sha256, version, timestamp}`) with `Cache-Control: public, max-age=300` (5-minute TTL)
- `canary.js` pointer for canary deployments (same structure as `latest.js`, different path)
- Worker CDN fetch is two-step: (1) fetch `latest.js` to get current bundle URL, (2) fetch content-addressed bundle (likely cached)
- Rollback: update `latest.js` to point to previous bundle hash + CF Cache Purge on `latest.js` path. Content-addressed bundles are never deleted.

## Consequences

### Positive

- Rollback blast radius reduced from 1 hour to 5 minutes.
- Content-addressed bundles are immutable and infinitely cacheable -- cache hit rate approaches 100% after first fetch.
- Rollback does not require deleting or replacing any bundle -- just re-pointing `latest.js`.

### Negative

- Two HTTP requests per bundle refresh (latest.js + content-addressed bundle) instead of one. Second request is almost always a cache hit.

### Neutral

- Old content-addressed bundles accumulate on CDN. Periodic cleanup of bundles older than 90 days is acceptable.

## Structural Assertions

1. "When a strategy bundle is published, its filename SHALL be `/strategies/v{sha256}.js` where `{sha256}` is the SHA-256 hash of the bundle content."
2. "When a content-addressed bundle is served, the CDN SHALL set `Cache-Control: public, max-age=31536000, immutable`."
3. "When `latest.js` is served, the CDN SHALL set `Cache-Control: public, max-age=300` (5-minute TTL)."
4. "When a rollback is triggered, the system SHALL update `latest.js` to point to the previous content-addressed bundle URL AND issue a CF Cache Purge API call on the `latest.js` path."
5. "When a Worker fetches a strategy bundle, it SHALL first fetch `latest.js`, then fetch the content-addressed bundle URL from the response."
6. "When a canary deployment is active, canary Workers SHALL fetch from `canary.js` instead of `latest.js`."

## Spec Changes Required

- **`specs/worker-core/STRUCTURE.md`:** Update CDN fetch to two-step (latest.js -> content-addressed bundle)
- **`specs/cdn-marketplace/STRUCTURE.md`:** Close Q6, replace 1-hour TTL with content-addressed model, add canary.js
- **`specs/ARCHITECTURE-ASSESSMENT.md`:** Close Q6
- **`specs/FMECA-ANALYSIS.md`:** Update FM-PD-02

## FMECA Cross-References

- **FM-PD-02:** Rollback mechanism fully specified. Content-addressed bundles + latest.js (5-min TTL) + CF Cache Purge. Blast radius 5 minutes, down from 1 hour.

---

## Amendment (2026-03-25): Multiple artifact families (ADR-010)

The same **pointer + content-addressed blob** pattern applies per **artifact kind**, not only `strategies`:

| Kind | Example pointer | Blob role |
|------|-----------------|-----------|
| `strategies` | `/extensions/strategies/latest.json` | Signed premium strategy bundle |
| `consent-runtime` | `/extensions/consent-runtime/latest.json` | `consent.js` (or successor) |
| `regulation-pack` | `/extensions/regulation-pack/latest.json` | Matrix / counsel default payloads |

Each kind uses its own `latest.json` (or `latest.js` pointer per publishing convention), **5-minute TTL** on the pointer, **immutable** content-addressed artifact URLs, and **CF Cache Purge** on pointer rollback. Customer Workers **cache** verified blobs in **KV/R2** (see ADR-010).
