# @attestrue/types

Shared TypeScript types for **Attestrack**: tracking events, strategy metadata, and **community consent** (KV config, consent commit, consent event records).

## Public surface

This package intentionally includes community consent contracts so operators and `@attestrue/consent-js` can share one vocabulary with the Worker. Attorney-maintained regulation packs and premium-only types belong in licensed extensions, not here.

## See also

- `@attestrue/schema` — Zod validators for the same contracts
- `docs/COMMUNITY-CONSENT.md` — how `ConsentConfig` maps to strategies
