# ADR-008: Standards Publication Gates

**Status:** Accepted (amended)  
**Date:** 2026-03-24  
**Amended:** 2026-03-25 — **CETS v1.1 / Trust Chain Spec** supersedes pre-v9.2 Merkle-tree standard drafts  
**Closes:** Q8 (Architecture Assessment)

## Context

Architecture Assessment Q8 asks whether the Consent Evidence Token Standard is premature. Publishing at Week 9-10 with 2-3 beta customers risks being ignored or locking in decisions prematurely.

**v9.2 / CETS v1.1:** The evidence model is **not** a per-event Merkle tree. The **authoritative** specification is the licensed **Consent Evidence Trust Chain Specification** v1.1 (`CONSENT-EVIDENCE-TRUST-CHAIN-SPEC.md` in **attestrue-premium**): RFC 8785 canonical documents, **`record_id`**, **Ed25519** witness, minimal signing input `{ site_id, record_id, timestamp }`, public **`POST /verify`**, and **daily `proof-anchors`** files whose **`daily_root`** hashes the **sorted concatenation** of that day’s `record_id` values (a **flat** commitment — not a Merkle tree). **Selective disclosure** is **out of scope** for v1.1 (full-document disclosure model); see Trust Chain Purpose § selective disclosure trade-off.

## Decision

Three-gate publication strategy. Gate 1: GitHub specification (Week 9-10) — publish the **public-facing** summary and pointers (this repo’s [`CONSENT-EVIDENCE-TOKEN-STANDARD.md`](../CONSENT-EVIDENCE-TOKEN-STANDARD.md) defers to the premium Trust Chain Spec). Gate 2: IAPP submission (at 50 customers). Gate 3: W3C Community Group (at 1000 customers).

Key design points:

- The **normative** cryptographic and verification contract is the **Trust Chain Spec** (premium); the **token standard** document in premium is a behavioral summary that defers to it.
- **ADR-002** product boundaries (community vs licensed Proof) remain the architecture frame; publication gates govern **how** the standard text is exposed and frozen over time.
- GitHub publication allows iteration before formal submission.
- IAPP publication establishes industry credibility at a meaningful customer count.
- W3C Community Group is the long-term path to formal standardization.
- The standard family is **living** until W3C submission — backwards-compatible changes are allowed at Gates 1 and 2.

## Consequences

### Positive

- GitHub-first approach allows iteration with real-world feedback before formal submission.
- 50-customer gate for IAPP ensures the standard is validated by production use.
- 1000-customer gate for W3C ensures sufficient adoption to justify formal standardization.

### Negative

- Delayed formal standardization means the standard has no authority beyond Attestrue's own implementation for the first year+.

### Neutral

- The standard’s value is primarily as a **documentation artifact** for court proceedings (proving the **trust chain** — `record_id`, witness, anchors — is publicly specified and not ad hoc).

## Structural Assertions

1. "When the Consent Evidence Token Standard pointer is published at Gate 1 in the public repository, it SHALL reference the **Trust Chain Spec** as the authoritative technical source for CETS v1.1."
2. "When the standard family reaches Gate 3 (W3C submission), all backwards-incompatible changes SHALL have been resolved — **RFC 8785 `record_id` derivation**, **canonical document field set** (`spec_version` / CETS level), **Ed25519** witness message and **`pubkey_fingerprint`** rules, **`/verify`** request shape, and **daily anchor** (`daily_root` over sorted `record_id` list) **SHALL** be frozen."
3. "When verification is performed per CETS v1.1, it SHALL follow the **three-step** procedure in the Trust Chain Spec (content re-hash, witness verification, anchor membership + `daily_root` check)."

## Spec Changes Required

- **Licensed product (`attestrue-premium`):** Keep **`docs/CONSENT-EVIDENCE-TRUST-CHAIN-SPEC.md`** and **`docs/CONSENT-EVIDENCE-TOKEN-STANDARD.md`** aligned; EARS modules under `specs/` SHALL trace to the Trust Chain Spec (not pre-v9.2 Merkle categories).
- **Public repo:** Maintain [`CONSENT-EVIDENCE-TOKEN-STANDARD.md`](../CONSENT-EVIDENCE-TOKEN-STANDARD.md) as a **pointer**; full normative text remains in the licensed tree.

## FMECA Cross-References

No direct FMECA failure mode. The standard is a documentation artifact, not a runtime component.
