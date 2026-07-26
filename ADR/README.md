# Architecture Decision Records

**Repository:** attestrack (public reference copies)
**Date:** 2026-03-24
**Context:** Closes open questions (Q1-Q3, Q5-Q8) from the Architecture Assessment (Phase 1)

---

## Decision Index

| ADR | Title | Closes | Status |
|-----|-------|--------|--------|
| [ADR-001](ADR-001-shared-component-library.md) | Shared Component Library | Q1 | Accepted |
| [ADR-002](ADR-002-evidence-licensed-only.md) | Evidence Is Licensed-Only; Community Gets Consent Log | Q2 | Accepted |
| [ADR-003](ADR-003-eager-policy-hash.md) | Eager Policy Hash at Init | Q3 | Accepted |
| [ADR-005](ADR-005-launch-jurisdictions.md) | Five Jurisdictions at Launch | Q5 | Accepted |
| [ADR-006](ADR-006-content-addressed-cdn.md) | Content-Addressed CDN Bundles | Q6 | Accepted |
| [ADR-007](ADR-007-signing-dlq.md) | 500ms Signing Timeout + DLQ | Q7 | Accepted |
| [ADR-008](ADR-008-standards-publication-gates.md) | Standards Publication Gates | Q8 | Accepted |
| [ADR-009](ADR-009-repo-boundary-enforcement.md) | Repository Boundary Enforcement | Audit | Accepted |
| [ADR-010](ADR-010-attestrack-core-extension-cache.md) | Attestrack Core + Extension Artifact Edge Cache | ADR-010 | Accepted |
| [ADR-011](ADR-011-kv-only-consent-event-storage.md) | KV-Only Consent Event Storage (No D1/R2 in OSS v1) | Plan P0.3 D1 | Accepted |
| [ADR-012](ADR-012-consent-cookie-topology.md) | Consent Cookie Topology — Worker-Set Cookie with Configurable Domain | Plan P0.3 D2 | Accepted |
| [ADR-013](ADR-013-warehouse-contract.md) | Warehouse Contract — Repo-Shipped Canonical `events` DDL | Plan P0.3 D3 | Accepted |

## Note

- ADR-004 (Portal-API Remains Rust) affects only private infrastructure and is not reproduced here
- ADR-001 through ADR-010: canonical versions are maintained in the private repository (same numbering in both repos)
- ADR-011 onward are **OSS-native** decisions — canonical in this repository

## Format

All ADRs follow Modified MADR with EARS structural assertions and FMECA cross-references.
