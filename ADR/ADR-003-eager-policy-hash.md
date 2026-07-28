# ADR-003: Eager Policy Hash at Init (Consent Runtime)

**Status:** Accepted in principle — **implementation spans community `consent-js` and licensed packs**

**Date:** 2026-03-24  
**Amended:** 2026-03-25

## Public repository stance

**Attestrack** ships **`packages/consent-js`** as the home for the **community** first-party script (stub → full implementation). Browser-side **eager policy hash at init**, three-way hash alignment, and consent payload fields apply to that script as it is built out. **Premium** `consent-runtime` and related CDN artifacts may extend or replace behaviors while keeping the **same Worker and KV contracts** where ADR-010 specifies.

## Where to read the full decision

- Canonical **ADR-003** narrative (eager fetch at init, `cache: 'no-store'`, closure-cached hashes, non-blocking fetch failure) is maintained alongside **consent-runtime** and **consent-js** implementations.  
- **CONSENT-ARCHITECTURE** and **REPO-SPEC** (licensed) describe deployment via **first-party Worker proxy**, not third-party script tags.

## Structural assertion (public)

1. This repository **MAY** implement ADR-003-aligned behavior inside `packages/consent-js` as the community consent script matures; the package **SHALL** exist here per [ADR-010](ADR-010-attestrack-core-extension-cache.md) and [ADR-002](ADR-002-evidence-licensed-only.md).
