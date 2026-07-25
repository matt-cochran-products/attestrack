# Community strategy submission

<!-- STR.5 — community strategies are submitted as pull requests to this repo.
     Author guide: ADAPTER-DEVELOPMENT-GUIDE.md -->

## Strategy

- **id:** <!-- e.g. `acme-events` — stable, unique -->
- **stage:** <!-- `destination` or `analytics` -->
- **Destination / service:** <!-- what it sends events to, with API docs link -->
- **Egress origins:** <!-- exact hosts this strategy fetches; nothing else -->
- **Secrets introduced:** <!-- names read via `host.getSecret`, e.g. `ACME_API_TOKEN` -->

## Author checklist

- [ ] Implements `Strategy` from `@attestrack/sdk`; manifest sets `defaultEnabled: false`
- [ ] `destination` stage only: `run` starts with `destinationsAllowed(ctx)` (consent gate + bot flag)
- [ ] Records outcomes with `recordDeliveryResult` (STR.4 — portal error surface)
- [ ] All credentials via `host.getSecret(...)`; no secrets, tokens, or per-customer endpoints in code; secret values never logged
- [ ] Egress only to the destination's documented API — no telemetry/vendor calls (`pnpm egress-check` passes)
- [ ] Exported from `packages/strategies/src/index.ts` and appended to `allBundledStrategies`
- [ ] Tests with `createMockHostRuntime`: success, HTTP error recorded, missing-secret no-op
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm boundary-check` green
- [ ] Docs: secret names added where operators look (scaffold secret list / `docs/SELF-HOSTING.md`) if applicable
- [ ] No licensed Proof / trust-chain constructs (ADR-010 / ADR-002)

## Notes for reviewers

<!-- rate limits, payload mapping decisions, anything non-obvious -->
