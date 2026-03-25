# ADR-009: Repository Boundary Enforcement

**Status:** Accepted
**Date:** 2026-03-24

## Context

ADR-002 mandated structural changes to the public repository (delete `packages/merkle/`, rename `evidence-unsigned.ts` to `consent-log.ts`, remove "evidence" from community UI). A repository boundary audit found naming and documentation issues that needed remediation to enforce clean separation between public and private repos.

## Decision

Enforce repository boundary through three mechanisms:

### 1. Immediate scaffold remediation (executed)

- Deleted `packages/merkle/` from public repo (per ADR-002)
- Renamed `evidence-unsigned.ts` to `consent-log.ts` (per ADR-002)
- Renamed `routes/evidence/` to `routes/consent-log/` (per ADR-002)
- Removed private repo name references from all public documentation
- Replaced license key format examples with `<your-license-key>` placeholder
- Updated dependency graphs to remove `@attestrue/merkle`

### 2. CI negative assertions (to be implemented)

When CI workflows are implemented, the following checks SHALL be added:
- Build fails if `packages/merkle/` directory exists
- Build fails if private repo name appears in public files
- Build fails if license key format is exposed in website or documentation
- Optional: fail if `@attestrue/types` public package exports consent/evidence types reserved for `@attestrue/types-extensions` (licensed)

### 3. Documentation update protocol

When an ADR is accepted that changes the public/private boundary:
1. Execute all scaffold changes immediately (do not defer)
2. Update CLAUDE.md and .cursorrules in the same session
3. Verify with grep that no private references remain

## Consequences

### Positive
- Public repo no longer exposes private repo name, license key format, or licensed-only package references
- ADR-002 structural assertions are now satisfied
- Protocol prevents future boundary violations from accumulating

### Negative
- CI checks add ~10s to build time
- ADR authors must follow the documentation update protocol

### Neutral
- Types/schema stub files remain in public repo. Deferred to a future iteration.

## Structural Assertions

1. "When `packages/merkle/` exists in the public repository, the CI build SHALL fail."
2. "When any file in the public repository contains the private repo name, the CI build SHALL fail."
3. "When an ADR changes the public/private boundary, all scaffold changes SHALL be executed before the ADR PR is merged."

## FMECA Cross-References

No direct FMECA failure mode. This ADR establishes the enforcement mechanism for boundary-related failure modes identified in the boundary audit.
