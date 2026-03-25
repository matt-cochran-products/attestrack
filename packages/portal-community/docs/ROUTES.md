# Portal routes ↔ behavioural spec

Canonical URL paths match the community portal prototype. Behavioural requirements live in [`docs/BEHAVORIAL-SPEC.md`](../../../docs/BEHAVORIAL-SPEC.md).

| Path | Spec (primary) | Notes |
|------|----------------|--------|
| `/dashboard` | Part III — Dashboard | Analytics-first; consent metrics via extensions (ADR-010) |
| `/signal` | Part IX — Analytics (Signal recovery) | |
| `/destinations` | Part IX — Destination health | |
| `/logs` | Portal observability | |
| `/extensions` | Extensions handoff | Consent / evidence / banner / policy / counsel → licensed product |
| `/strategies` | Part VI — Strategies | |
| `/configuration` | Site configuration | Deployment facts + **Attestrue upgrade** handoff (no enforcement toggle in OSS) |
| `/analytics` | Part IX — Analytics dashboard | |
| `/explore` | Part X — Explore | |
| `/migration` | Handoff only | **Not** an OSS CMP migration wizard — link to attestrue.com upgrade (legacy path may remain bookmarked) |
| `/upgrade` | Part XII — Upgrade | Outbound `attestrue.com/upgrade?site_id=` (PORTAL.10) |

Legacy paths `/consent`, `/evidence`, `/banner`, `/policy`, `/counsel` redirect to `/extensions`.

There is no `/deploy` route in the prototype; deployment status is surfaced under Site configuration and the shell context.
