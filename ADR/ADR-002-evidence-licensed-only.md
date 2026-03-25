# ADR-002: Proof / Canonical Evidence Licensed; Community Consent in Attestrack

**Status:** Accepted (amended)  
**Date:** 2026-03-24  
**Amended:** 2026-03-25 — **ADR-010** (extensions on CDN + edge cache); **community consent** (KV `ConsentConfig`, mandatory strategies, `consent-js`)  
**Closes:** Q2 (Architecture Assessment)

## Context

Architecture Assessment Q2 asks what the community-mode evidence shape is. **v9.2** resolved: no Merkle tree; **RFC 8785** canonical JSON, **`record_id` = SHA-256**, signing input **`{ site_id, record_id, timestamp }`** only for **Proof**.

**Community consent** (this repository) ships **operator-managed** `ConsentConfig`, mandatory strategies (**jurisdiction**, **consent**, **evidence-unsigned**), HMAC privacy consent tokens, and **`@attestrue/consent-js`**. **Flat** `ConsentEventRecordV1` is **self-attested operational** evidence — not the **Proof** / witnessed canonical record.

## Decision

- **No `@attestrue/merkle`** in the public repository. **No per-event Merkle tree** in the evidence architecture.
- **Attestrack** SHALL include **`packages/consent-js`** and **community** mandatory consent strategies (see [`docs/COMMUNITY-CONSENT.md`](../docs/COMMUNITY-CONSENT.md)). **Premium** upgrades **jurisdiction sourcing** via `StrategyManifest.replaces` (e.g. `JurisdictionCompleteStrategy` replaces **`jurisdiction`**).
- **Canonical consent evidence** (witnessed), **attorney-maintained regulation matrix**, and **Proof** remain **licensed** extension artifacts (CDN + edge cache) where applicable — not duplicated as Merkle in OSS.
- **Proof** is **witnessing only** — it does **not** bundle **Operating Agreement** or **Acknowledgment** SKUs (v9.2 §3.4–3.5).

### Architecture Table

| Layer | Attestrack (this repo) | Licensed extensions |
|-------|--------------------------|----------------------|
| Analytics / ingest | Yes | Same |
| Ad network proxying | Yes | Same |
| Consent gate / banner / IOA | **Yes (community KV + `consent-js`)** | Enhanced runtime packs; attorney-maintained config |
| Consent operational record | **Yes (`ConsentEventRecordV1`, unsigned)** | Canonical witnessed record + proof + ledger when Proof active |
| Evidence verification | N/A (no Proof in core) | **`record_id`**, **`/verify`**, **`proof-anchors`** |

## Structural Assertions (v9.2 + ADR-010)

1. When an Attestrack Worker runs **without** licensed Proof, it SHALL NOT call Attestrue **`/sign`** for **witnessed canonical** evidence (community tier uses HMAC token + flat operational record only).
2. When **`packages/merkle/`** exists in this repository, the CI build SHALL fail.
3. When licensed **Proof** is active (via customer-deployed extension binding), the signing service SHALL accept only **`site_id`**, **`record_id`**, and **timestamp`** — never the full document body.
4. When a **daily anchor** is published, the same commit content SHALL be pushed to **both** public `proof-anchors` mirrors.

## Consequences

### Positive

- Free tier is **deployable with working consent contracts**; paid tier improves **currency and legal maintenance** of configuration, not basic existence.
- Standard verification (RFC 8785) for **licensed** records — no proprietary Merkle library in OSS.

### Negative

- Operators using only the community tier **must** maintain their own `ConsentConfig` or accept static defaults.

---

*Supersedes prior “no consent-js / no mandatory consent strategies in OSS” wording tied to ADR-010 v1.*
