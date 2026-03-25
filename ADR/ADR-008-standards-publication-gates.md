# ADR-008: Standards Publication Gates

**Status:** Accepted
**Date:** 2026-03-24
**Closes:** Q8 (Architecture Assessment)

## Context

Architecture Assessment Q8 asks whether the Consent Evidence Token Standard is premature. Publishing at Week 9-10 with 2-3 beta customers risks being ignored or locking in decisions prematurely. The standard draft defines the Merkle tree structure that the signing service must conform to.

## Decision

Three-gate publication strategy. Gate 1: GitHub specification (Week 9-10) -- publish the standard as a GitHub document in this (public) repository. Gate 2: IAPP submission (at 50 customers) -- submit to the International Association of Privacy Professionals for industry review. Gate 3: W3C Community Group (at 1000 customers) -- pursue formal standardization through a W3C Community Group.

Key design points:

- The standard defines the Merkle tree structure, leaf ordering, and selective disclosure proof format
- The standard is a technical dependency for ADR-002 (evidence-merkle architecture)
- GitHub publication allows iteration before formal submission
- IAPP publication establishes industry credibility at a meaningful customer count
- W3C Community Group is the long-term path to formal standardization
- The standard is living until W3C submission -- backwards-compatible changes are allowed at Gates 1 and 2

## Consequences

### Positive

- GitHub-first approach allows iteration with real-world feedback before formal submission.
- 50-customer gate for IAPP ensures the standard is validated by production use.
- 1000-customer gate for W3C ensures sufficient adoption to justify formal standardization.

### Negative

- Delayed formal standardization means the standard has no authority beyond Attestrue's own implementation for the first year+.

### Neutral

- The standard's value is primarily as a documentation artifact for court proceedings (proving the Merkle structure is publicly specified and not ad hoc).

## Structural Assertions

1. "When the Consent Evidence Token Standard is published at Gate 1, it SHALL be hosted as a document in the public repository."
2. "When the standard reaches Gate 3 (W3C submission), all backwards-incompatible changes SHALL have been resolved -- the Merkle leaf structure, tree depth, and hash algorithm SHALL be frozen."
3. "When a selective disclosure proof is generated, it SHALL conform to the proof format defined in the Consent Evidence Token Standard."

## Spec Changes Required

- **`specs/ARCHITECTURE-ASSESSMENT.md`:** Close Q8
- **`specs/MANIFEST.md`:** Add standards publication reference
- **`specs/evidence-merkle/STRUCTURE.md`:** Cross-reference standard conformance

## FMECA Cross-References

No direct FMECA failure mode. The standard is a documentation artifact, not a runtime component.
