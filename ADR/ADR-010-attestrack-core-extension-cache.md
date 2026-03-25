# ADR-010: Attestrack Core Scope + Extension Artifact Edge Cache

**Status:** Accepted (reference copy — canonical narrative maintained with licensed product source)  
**Date:** 2026-03-25

## Summary

Attestrack (this repository) ships **free analytics**, **self-hosted server-side measurement**, and a **complete community consent path**: operator **`ConsentConfig` in KV**, mandatory strategies (**jurisdiction**, **consent**, **evidence-unsigned**), HMAC privacy consent tokens, and **`@attestrue/consent-js`** (first-party banner / GPC / token coordination / script gating — contracts and stubs first; behavior lands incrementally).

**Paid extensions** upgrade **how** consent configuration is sourced and maintained — not whether consent exists. **Privacy Consent** provides attorney-maintained, case-law-current rows and auto-updates after rulings, writing the **same KV document shape** (or key) the community tier uses. **Proof / Merkle** and other licensed artifacts remain extension-only where applicable.

**Regulation-led UX:** operator-facing copy uses **regulation**; **jurisdiction** remains the technical mapping term (geo/signal → row).

## Decisions (abbreviated)

- `packages/consent-js` **exists** in the public repo; it is the home for the community first-party consent script (stub → implementation).
- Community mandatory strategies **JurisdictionStrategy**, **consent gate**, and **EvidenceUnsignedStrategy** live in `@attestrue/strategies` (stubs → implementation). Premium **JurisdictionCompleteStrategy** declares `replaces: ['jurisdiction']` so CDN-injected code **supersedes** the community jurisdiction strategy without changing Worker bindings or KV schema.
- CDN pointer + content-addressed blobs apply to **premium strategy bundles**, **consent-runtime** enhancements, and **regulation-pack** artifacts (see full ADR in licensed product documentation).
- Operator-maintained **`ConsentConfig`** defaults ship in-repo (`COMMUNITY_DEFAULT_CONSENT_CONFIG` + JSON template); they are **not** attorney-maintained legal advice.

## Structural assertions

1. Public Attestrack SHALL NOT require **premium** regulation packs to build or run **core analytics + community consent contracts**.
2. CI on this repository SHALL fail if `packages/merkle/` exists (permanent withdrawal, ADR-002 / token standard v9.2).
3. Extension fetch SHALL be server-side with local edge cache and first-party proxy to browsers (per licensed Worker integration).

---

*Full decision record, artifact cache TTLs, and FMECA cross-references: maintained alongside the licensed Attestrue product ADR set (ADR-010 canonical).*
