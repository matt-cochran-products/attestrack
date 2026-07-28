# Consent Evidence Token Standard (reference)

**Authoritative technical specification:** The **Consent Evidence Trust Chain Specification** (CETS v1.1) lives in the licensed product documentation tree as **`attestrue-premium/docs/CONSENT-EVIDENCE-TRUST-CHAIN-SPEC.md`**. It defines the full mathematical trust chain: RFC 8785 canonical documents, **`record_id`**, **Ed25519** proof blobs, signing service input `{ site_id, record_id, timestamp }`, public **`POST /verify`**, and daily **`proof-anchors`** (`daily_root` over sorted `record_id` list — **not** a Merkle tree).

**Summary layer:** **`CONSENT-EVIDENCE-TOKEN-STANDARD.md`** in the same premium tree is a behavioral summary that defers to the Trust Chain Spec.

**Attestrack (this repository)** ships **analytics and server-side measurement only** (ADR-010). Canonical consent evidence, proof blobs, and ledger semantics apply when **Attestrue extensions** are deployed — not to the open-source core alone.

For implementation or counsel-facing bundles, use the premium **Trust Chain Spec** and summary token standard, or your shipped documentation package.
