# ADR-012: Consent Cookie Topology — Worker-Set Cookie with Configurable Domain

**Status:** Accepted (implemented in Phase 2, PR #8, merged to `dev` as `e949bc0`)
**Date:** 2026-07-25

## Context

The documented deployment topology puts the customer's page on `www.example.com` and the Attestrack Worker on a tracking subdomain (`t.example.com`). The original `consent-js` stub persisted the consent token via `document.cookie` **without a `Domain` attribute** — a host-only cookie on the *page* origin that the browser never sends to the Worker's subdomain. The Worker's consent gate therefore always saw `consent: null`, and there was no CORS/OPTIONS handling for cross-origin credentialed requests. The consent gate → destination pipeline was architecturally broken end-to-end for the primary deployment model (production plan §1.2 #1).

Two candidate fixes were considered:

1. **Worker issues `Set-Cookie` on the commit response** with a configurable parent `Domain` — chosen.
2. First-party proxy path (route all page traffic through the Worker so cookies are same-origin) — rejected for v1: it changes the deployment story (Worker must front the whole site), adds latency/cost, and is unnecessary once the cookie `Domain` is correct.

## Decision

The **Worker sets the consent cookie** on the consent-commit response; the client never owns cross-subdomain cookie persistence.

As implemented in `packages/worker-core/src/create-fetch-handler.ts` (`buildConsentCookie`, used by `POST /__attestrack__/consent/commit`):

- `Set-Cookie: at_consent=<token>; Domain=<cookieDomain ?? domain>; Path=/; Max-Age=<state1TokenTTL>; Secure; SameSite=Lax`
- `Domain` comes from site config: `cookieDomain` (optional override, `packages/worker-core/src/config.ts`) falling back to the registered `domain`, so the cookie spans `www.` and `t.` subdomains.
- **Host-only fallback:** when the Worker's own hostname is *outside* the configured domain (browsers reject such `Domain` attributes), the `Domain` attribute is omitted and the cookie is host-only.
- **No `HttpOnly`:** `consent-js` reads `at_consent` client-side to render current banner state (`packages/consent-js/src/banner.ts`); this token is an HMAC-signed consent assertion, not a session credential.
- Supporting pieces, same PR:
  - `consent-js` sends `credentials: 'include'` on commit and tracking requests; `document.cookie` writing survives only as a same-origin fallback (`packages/consent-js/src/commit.ts`).
  - Credentialed CORS allowlist derived from site config `domain` + `trustedDomains` with explicit `OPTIONS` preflight handling and no wildcard reflection (`packages/worker-core/src/cors.ts`).
  - The Worker serves `GET /consent.js` first-party (embedded IIFE bundle) so the scaffold script tag works.

Contract coverage: `packages/worker-core/__tests__/contract/cors-cookie-consentjs.contract.test.ts`; route surface pinned in `docs/oss-http-contract.json` (CI gate `route-contract-check`).

## Consequences

### Positive
- The consent gate actually receives the token in the documented `www.` page / `t.` worker topology; §1.2 #1 is closed with regression tests.
- Cookie policy is operator-controllable (`cookieDomain`) without code changes.
- No wildcard CORS: credentialed responses only ever echo allowlisted origins.

### Negative
- Operators with the Worker on an unrelated domain (host-only fallback) do not get cross-subdomain consent persistence — they must move the Worker inside the site's registrable domain (this is the documented deployment model).
- `SameSite=Lax` means the cookie is not sent on cross-site subresource requests from unrelated sites — intentional.

### Neutral
- A first-party proxy topology remains possible later without changing the KV or token contracts.

## Structural Assertions

1. The consent-commit response SHALL carry a `Set-Cookie` for `at_consent` with `Secure; SameSite=Lax`, and `Domain` = site config `cookieDomain ?? domain` when the request hostname is within that domain, host-only otherwise.
2. Credentialed CORS SHALL echo only origins allowlisted via site config `domain`/`trustedDomains`; wildcard reflection SHALL NOT occur.
3. `consent-js` SHALL NOT be the authority for cross-subdomain cookie persistence (same-origin fallback only).

## FMECA Cross-References

No direct FMECA failure mode. Closes production plan §1.2 #1 (consent cookie never reaches the Worker), the top-ranked launch-blocking defect.
