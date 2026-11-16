---
id: ADR-0001
title: "Bot protection: adopt the portfolio standard"
status: proposed
date: 2026-11-16
supersedes: []
applies_to:
  - "**/Cargo.toml"
  - "**/package.json"
  - "**/*urnstile*"
  - "**/auth/**"
  - "**/*auth*"
  - "**/*sign*"
  - "**/*invite*"
  - "**/*vouch*"
  - ".github/workflows/**"
rules:
  - id: R1
    text: "Turnstile tokens are verified server-side by the product's first-party verifier: one shared HTTP client with a timeout of at most 2 seconds, a siteverify call carrying remoteip and an idempotency_key, and acceptance only when success is true, hostname is one of the environment's allowed hostnames and action equals the endpoint's expected action. Third-party Turnstile middleware or client crates (axum-turnstile, cf-turnstile) are not used."
  - id: R2
    text: "Every Turnstile-protected endpoint declares its degrade policy for a siteverify timeout or error: established-session actions are allowed with a tighter per-account rate limit and flagged for later scoring; admission actions (sign-up, request access, invite accept) are accepted into a pending, verify-later state and never refused; anonymous public forms are refused with a retry message. An invalid token is always refused."
  - id: R3
    text: "React forms use @marsidev/react-turnstile in managed mode, with a distinct action per form, and reset the widget after each submit. A widget error or expiry never disables submit; the request is sent without a token and the server applies R2."
  - id: R4
    text: "The Turnstile secret key never appears in source, committed configuration, CI variables, Terraform outputs or logs; it reaches the runtime only through the sealed runtime bundle. Only the public site key is committed. CI and local development use Cloudflare's published test keys."
  - id: R5
    text: "Passkeys (webauthn-rs) and proof of personhood (World ID) are optional step-ups. Neither is ever the only way to sign up, publish content or clear a flag: every step-up offers a path that needs no particular device or provider (for example vouches or human review)."
  - id: R6
    text: "Bot-protection failures map to the transport's own error type (tonic::Status on gRPC routes, never plain-text HTTP bodies) with neutral wording; no user-visible text calls a named person a bot."
---
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
