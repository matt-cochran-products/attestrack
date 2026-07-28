# ADR-001: Shared Component Library

**Status:** Accepted
**Date:** 2026-03-24
**Closes:** Q1 (Architecture Assessment)

## Context

Architecture Assessment Q1 asks whether community (#16) and licensed (#42) portals should share a component library. Decision 7 recommended investigating a shared component library rather than merging the apps. The portals have different deployment models (community on customer CF Pages, licensed on app.attestrue.com) but significant UI duplication (dashboard, evidence viewer, configuration panels, jurisdiction map).

## Decision

Create `packages/ui/` as `@attestrack/ui` in this repository, consumed by portal-community (#16) and by the licensed portals in the private repo. This is a shared presentational component library -- no backend dependencies, no business logic. Both portals import from `@attestrack/ui` for shared UI components (evidence chain viewer, jurisdiction map, proof badge, configuration panels, dashboard widgets). This resolves Decision 7 (Evaluate Community/Licensed Portal Merge) -- the answer is: shared library, not merged app.

## Consequences

### Positive
- Eliminates 2-4 weeks of duplicate portal UI work. Consistent UX across all portals. Single place to update shared components.
- Both portals maintain separate deployment models (customer CF Pages vs app.attestrue.com) -- no deployment constraint conflict.

### Negative
- New package to maintain in the public repo monorepo. Version coordination across portal consumers in both public and private repos.

### Neutral
- Does not affect the separate counsel portal decision (Decision 4, confirmed).

## Structural Assertions

1. "When `@attestrack/ui` exports a component, that component SHALL be presentational only -- no API calls, no business logic, no backend dependencies."
2. "When portal-community (#16) renders a shared view, it SHALL import the component from `@attestrack/ui`."
3. "When `@attestrack/ui` is consumed, it SHALL NOT require any backend service to render -- data is provided by the consuming portal via props."

## Spec Changes Required

- **Public repo:** Create `packages/ui/` with package.json (`@attestrack/ui`, private initially, published to npm when stable)
- **`specs/customer-portal/STRUCTURE.md`:** Close Q1, add `@attestrack/ui` consumption assertions
- **`specs/MANIFEST.md`:** Add `@attestrack/ui` to component allocation
- **`specs/ARCHITECTURE-ASSESSMENT.md`:** Close Q1, update Decision 7

## FMECA Cross-References

No direct FMECA failure mode. Indirectly reduces FM-PD-01 risk (contract drift) by centralizing shared UI.
