# 0001 — Bot protection: adopt the portfolio standard

Status: proposed. Follows infra ADR 0018 ([matt-cochran-products/infra#2239](https://github.com/matt-cochran-products/infra/blob/platform/bot-protection-adr/docs/design/0018-portfolio-bot-protection.md)). Tracking: #122.

## Context

The portfolio has one shared bot-protection standard so every product defends sign-up, sign-in, forms and user-generated content the same way, with one challenge provider, one secret-handling path and one failure policy.

## Decision

This product adopts infra ADR 0018 as written:

1. **Edge:** Cloudflare WAF rate limits on this product's hostnames. No blanket Bot Fight Mode on API, gRPC-Web, webhook or widget hostnames.
2. **Cloudflare Turnstile (managed mode)** on admission actions (sign-up, sign-in, recovery, invite or request acceptance), public forms, reports and user-content submits.
   - The front end uses `@marsidev/react-turnstile` with a per-form `action`, and never blocks submit when the widget errors.
   - The server uses a first-party verifier: a 2-second timeout, `remoteip`, an idempotency key, and `success`, `hostname` and `action` checks, mapped to the transport's errors.
   - A per-endpoint **degrade policy**: established sessions are allowed with tighter limits, admissions go into a pending state, and anonymous forms are refused with a retry message.
3. **Application rate limits** per IP, account and target, with no account probing.
4. **Layer 7 metrics:** `bot_challenge_total`, `bot_degrade_total` and siteverify latency, with alerts.
5. **Secrets:** the Turnstile widget is created in infra Terraform. Only the site key appears in this repo; the secret arrives in the sealed runtime bundle. CI uses Cloudflare's test keys.

## Product-specific layers

Layers 4–6 (accountable admission, step-up verification, optional proof of personhood) are **to be decided** for this product by its owner in a follow-up ADR. Until then, layers 1–3 and 7 apply.

## Consequences

Adoption follows 0018's checklist (tracked in #122): an infra widget PR (staging, then production), the sealed secret, the verifier and its tests, the React widget on the listed forms, metrics and alerts, and a privacy-notice update naming Cloudflare Turnstile.
