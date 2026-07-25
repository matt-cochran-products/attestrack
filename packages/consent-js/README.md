# @attestrack/consent-js

Community **first-party consent script** for Attestrack: banner, Global Privacy Control handling, HMAC consent token coordination with the Worker, and script blocking. The package is **stubbed** here; behavior will ship incrementally alongside mandatory Worker strategies.

## Configuration (KV)

Operators store **`ConsentConfig`** (validated by `consentConfigSchema`) in their own KV. A JSON template ships at [`templates/community-default-consent-config.json`](./templates/community-default-consent-config.json). The same TypeScript defaults are exported as `COMMUNITY_DEFAULT_CONSENT_CONFIG` from `@attestrack/types`.

**Not legal advice.** Community defaults are sensible starting points for a working deployment; keeping them current as laws change is the operator’s responsibility.

> Community consent ships with sensible defaults for US-CA, EU, and a global fallback. You are responsible for keeping your own `ConsentConfig` current as laws change. If you want attorney-maintained configurations that auto-update after rulings, that is the Privacy Consent add-on (see product pricing).

## Premium extension

**JurisdictionCompleteStrategy** (paid) declares `replaces: ['jurisdiction']` on its manifest. When the CDN loader injects it, the community **JurisdictionStrategy** is omitted from Stage 1. KV schema, Worker shape, and customer Cloudflare account stay the same; only the source and maintenance of the config rows change.

See [Community consent & extensions](../../docs/COMMUNITY-CONSENT.md) in this repo.
