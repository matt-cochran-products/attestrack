# API reference — Worker HTTP, KV registry, consent token

Operator/integrator reference for the OSS Attestrack surface, in three parts:

1. [Worker HTTP routes](#worker-http-routes) — every route the Worker serves
2. [KV key registry](#kv-key-registry) — every `attestrack:*` key, who writes it, and its shape
3. [Consent token format](#consent-token-format-community-tier) — the community-tier HMAC token

**Sources of truth.** The route tables below are derived from
[`oss-http-contract.json`](oss-http-contract.json) (the machine-readable contract) and must
list exactly the routes it lists — `pnpm route-contract-check` keeps that JSON in lockstep
with the Worker source, and any PR that changes routes must update the JSON, this file, and
[REPO-SPEC-OSS.md](REPO-SPEC-OSS.md) together. Key names come from
[`packages/types/src/kv-keys.ts`](../packages/types/src/kv-keys.ts); token behavior from
[`packages/sdk/src/consent-token.ts`](../packages/sdk/src/consent-token.ts). Where this
reference and those files disagree, the code + contract JSON win.

Error codes are named inline; their canonical meanings and statuses live in the
[REPO-SPEC-OSS JSON error contract](REPO-SPEC-OSS.md#json-error-contract-fail-fast-triage-friendly).

---

## Worker HTTP routes

All routes are served by the single Worker (`createAttestrackFetchHandler` in
[`packages/worker-core/src/create-fetch-handler.ts`](../packages/worker-core/src/create-fetch-handler.ts)).

### Top-level routes

| Method | Path | Purpose | Errors |
|---|---|---|---|
| GET | `/health` | Liveness — `200` plain `ok` | — |
| GET | `/privacy` | Privacy policy text from KV `attestrack:policy:privacy` (placeholder when unset) | — |
| GET | `/terms` | Terms text from KV `attestrack:policy:terms` (placeholder when unset) | — |
| GET | `/consent.js` | First-party consent banner script — the `@attestrack/consent-js` IIFE embedded at Worker build time; `ETag`/`304` caching; public wildcard CORS (no credentials) | — |
| GET | `/__attestrack__/consent/context` | Resolved jurisdiction context for the banner: `{ siteId, mode, jurisdictionKey, row, policyRefs }`; credentialed CORS | — |
| POST | `/__attestrack__/consent/commit` | Mint a consent token from a `ConsentCommitRequest` body (`siteId`, `decision`, `policyHash`, optional `jurisdictionHint`, `ioaAccepted`). Returns `{ token }` and sets the `at_consent` cookie (`Domain` from site config `cookieDomain ?? domain`, `Max-Age` = `state1TokenTTL`, `Secure; SameSite=Lax`) | `invalid_json`, `invalid_body`, `consent_secret_not_configured`, `consent_secret_too_weak` |
| POST | `/t/event` | Tracking ingest — body validated with `trackingEventV1Schema`; responds `{ ok: true, accepted: true }` immediately, pipeline runs in the background (`scheduleBackground`); credentialed CORS | `invalid_json`, `invalid_body` |
| OPTIONS | `/__attestrack__/consent/commit`, `/__attestrack__/consent/context`, `/t/event` | CORS preflight for the three credentialed browser routes | — |
| GET | *anything else* | Runs the full pipeline (mandatory → destinations → analytics); JSON `{ ok, consentDecision }` | — |

**CORS.** The three credentialed routes (`commit`, `context`, `/t/event`) allow credentials
with an origin allowlist derived from site config `domain` + `trustedDomains` (https-only;
loopback origins only when explicitly listed; no wildcard reflection). `/consent.js` is
served with a public wildcard origin and no credentials.

### Portal API — `/__attestrack__/portal/v1`

> **Authentication.** Portal routes are **unauthenticated by design** — Cloudflare Access
> is assumed in front of the Worker (PORTAL.1). Without it this is a world-writable config
> API. Defense-in-depth: set the Worker secret `PORTAL_API_SHARED_SECRET`, after which every
> portal request must carry the `x-attestrack-portal-secret` header or receives
> `401 portal_unauthorized`. Details: [REPO-SPEC-OSS.md](REPO-SPEC-OSS.md#portal-api),
> [THREAT-MODEL.md](THREAT-MODEL.md).

All subpaths below are relative to the prefix. Unknown subpaths return `404 not_found`;
wrong methods return `405 method_not_allowed`.

#### GET subpaths

| Subpath | Purpose | Data source |
|---|---|---|
| `/site-config` | Site configuration (`SiteConfigKv`) | KV `attestrack:portal:site_config` |
| `/configuration` | Alias of `/site-config` (same payload) | KV `attestrack:portal:site_config` |
| `/strategies` | Strategy list (operator config) | KV `attestrack:portal:strategies` |
| `/dashboard` | `eventsToday`, drift alerts, strategy status | **Computed** from recorded traffic (`attestrack:obs:*`, `attestrack:drift:mismatch`) — never seeded JSON |
| `/destinations` | Per-strategy delivery stats + secret presence | **Computed** (`attestrack:obs:delivery:*`); quiet endpoints report `no_data` |
| `/alert-rules` | Operator alert rules (+ synthetic drift row while a mismatch is active) | KV `attestrack:portal:alert_rules` |
| `/logs`, `/logs/incoming` | Recent request log | **Computed** — bounded per-hour KV ring (`attestrack:obs:log:*`, 60/hour, 48 h TTL) |
| `/signal`, `/signal-recovery` | Signal recovery status | **De-scoped v1**: `{ measured: false, reason: 'requires_beacon', botRequestsFiltered }` — no invented numbers |
| `/signal-recovery/timeline` | Recovery timeline | **De-scoped v1**: always `[]` |
| `/analytics/curated` | Curated chart descriptors + warehouse status (no series on GET) | **Computed** |
| `/explore/saved-queries` | Saved Explore queries (per-user pins via `Cf-Access-Authenticated-User-Email`) | KV `attestrack:portal:saved_queries` (Zod-validated) |

#### POST subpaths

| Subpath | Purpose | Errors |
|---|---|---|
| `/explore/query` | Run one gated SQL statement (`{ sql }`) against the operator warehouse (Tinybird, else ClickHouse) | `invalid_sql`, `explore_warehouse_not_configured`, `explore_warehouse_http_error`, `explore_warehouse_fetch_failed`, `explore_warehouse_rejected`, `explore_warehouse_bad_response` |
| `/explore/saved-queries` | Save a query (`{ name, sql }`; SQL passes the same gate) | `invalid_body`, `invalid_sql`, `saved_queries_limit` |
| `/explore/saved-queries/remove` | Remove a saved query (`{ id }`) | `invalid_body` |
| `/explore/saved-queries/pin` | Pin/unpin to Analytics (`{ id, pinned, chart? }`) — personal per Access identity | `invalid_body` |
| `/site-config/trusted-domains` | Replace the trusted-domains list (`{ domains }`) — feeds the CORS allowlist | `invalid_domains` |
| `/analytics/curated` | Compute ONE curated chart (`{ chartId, dateFrom, dateTo }`) through the same Explore gate | `invalid_body`, warehouse errors as above |
| `/analytics/warehouse-status` | Probe warehouse configuration — `{ configured, message }` | — |
| `/strategies/toggle` | Enable/disable a destination/analytics strategy id | `invalid_body` |

#### Licensed-only subpaths — `403 requires_attestrue`

These exist in the OSS Worker only as honest refusals: the response is
`403 { error: 'requires_attestrue', handoff }`, where `handoff` is the static upgrade URL
(the `ATTESTRUE_UPGRADE_ORIGIN` constant in
[`portal.ts`](../packages/worker-core/src/portal.ts) — never fetched, only handed to the
browser; `pnpm egress-check` enforces that). Implementations ship in the licensed
extension ([ADR-010](../ADR/ADR-010-attestrack-core-extension-cache.md)).

| Method | Subpaths |
|---|---|
| GET | `/policy`, `/policy-versions`, `/banner`, `/banner/history` |
| POST | `/site-config/mode`, `/policy-versions`, `/banner` |

---

## KV key registry

Authoritative names: [`packages/types/src/kv-keys.ts`](../packages/types/src/kv-keys.ts).
Deploy-seed shape: [`packages/deploy/src/kv-schema.ts`](../packages/deploy/src/kv-schema.ts).
Policy: keys are **additive** across releases, versioned values carry a `v` field, and
readers default missing keys — see
[PILOT-OSS.md → KV key versioning policy](PILOT-OSS.md#kv-key-versioning-policy).

| Key | Value | Written by |
|---|---|---|
| `attestrack:consent_config` | `ConsentConfig` JSON (`consentConfigSchema`) — jurisdiction rows, banner copy | Deploy seed; operator |
| `attestrack:policy:privacy` | Plain text for `GET /privacy` | Deploy seed; operator |
| `attestrack:policy:terms` | Plain text for `GET /terms` | Deploy seed; operator |
| `attestrack:portal:site_config` | `SiteConfigKv` JSON (mode, domain, `cookieDomain`, `trustedDomains`, TTLs) | Deploy seed; Worker (`/site-config/trusted-domains`) |
| `attestrack:portal:strategies` | Strategy list JSON (operator config) | Portal API |
| `attestrack:portal:alert_rules` | Alert-rule config JSON | Operator |
| `attestrack:portal:saved_queries` | Saved Explore queries JSON — Zod-validated (`savedQueriesKvSchema`), max 100 entries, per-user pins | Worker (saved-queries routes) |
| `attestrack:portal:analytics` | Reserved — **not read by the OSS Worker** (curated analytics are computed, never seeded) | — |
| `attestrack:portal:policy` | Reserved for the licensed extension (`requires_attestrue` in OSS) | — |
| `attestrack:portal:banner` | Reserved for the licensed extension (`requires_attestrue` in OSS) | — |
| `attestrack:enabled_strategies` | JSON array of strategy ids — gates **destination/analytics** stages only (mandatory always runs); missing/invalid ⇒ all optional strategies eligible | Deploy seed; Worker (`/strategies/toggle`) |
| `attestrack:drift:expected_fingerprint` | SHA-256 of the consent-config JSON exactly as seeded | Deploy seed |
| `attestrack:drift:current_fingerprint` | Last fingerprint computed on traffic | Worker (drift-detection strategy) |
| `attestrack:drift:mismatch` | `{ at, expected, current }`, TTL'd — drives the portal drift banner/alerts | Worker (drift-detection strategy) |
| `attestrack:obs:log:<YYYY-MM-DDTHH>` | Bounded request-log ring (60 entries/hour, 48 h TTL) | Worker — **never seed** |
| `attestrack:obs:events:<YYYY-MM-DD>` | Sampled per-UTC-day ingest counter (approximate above 5 000/day) | Worker — **never seed** |
| `attestrack:obs:delivery:<strategyId>` | Per-strategy delivery stats (`DeliveryStats`: ok/error totals, today window, last error) | Worker — **never seed** |
| `attestrack:obs:bots:<YYYY-MM-DD>` | Per-day bot-filtered request counter (troll-shield) | Worker — **never seed** |
| `attestrack:consent_event:*` | Individual consent-event records (`ConsentEventRecordV1`, unsigned), operator-configurable TTL (default 90 days). Deterministic keys for dedup: `tok:<sig>:<decision>` (token-backed) and `gpc:<siteId>:<jurisdiction>:<day>` (token-less honored GPC) | Worker — **never seed** |

Observability counters and logs are best-effort KV writes: treat them as approximate lower
bounds, never billing-grade numbers.

---

## Consent token format (community tier)

Implemented in [`packages/sdk/src/consent-token.ts`](../packages/sdk/src/consent-token.ts)
(`createPrivacyConsentToken` / `verifyPrivacyConsentToken`); carried in the `at_consent`
cookie and returned by `POST /__attestrack__/consent/commit`.

```
k<N>.<payload-b64url>.<sig-b64url>
```

- **`k<N>`** — key id (`k1`, `k2`, …) enabling secret rotation.
- **`payload-b64url`** — base64url of the **canonical** payload JSON: keys sorted
  (`stableConsentPayloadJson`), so each payload has exactly one string form.
- **`sig-b64url`** — base64url HMAC-SHA256 over the string `k<N>.<payload-b64url>` — the
  key id is tamper-bound into the signature.

**Payload** (`PrivacyConsentTokenPayloadV1`, validated by
`privacyConsentTokenPayloadV1Schema`):

| Field | Type | Notes |
|---|---|---|
| `v` | `1` | Payload version |
| `siteId` | string | Verify-time binding: `expectedSiteId` mismatch ⇒ rejected (`wrong_site`) |
| `decision` | `granted` \| `declined` \| `withdrawn` | |
| `issuedAt` | ISO 8601 | |
| `expiresAt` | ISO 8601, optional | Set from site config `state1TokenTTL` at mint; tokens without it never expire — always mint with a TTL in production |
| `policyHash` | string | Policy version the visitor consented to |
| `jurisdictionHint` | string, optional | |
| `ioa` | string[], optional | IOA assertion ids affirmatively accepted; absent ⇒ "not attested" |

**Hardening (P7.2)** — behavior verified in
[`packages/sdk/__tests__/consent-token-hardening.test.ts`](../packages/sdk/__tests__/consent-token-hardening.test.ts):

- Signing secrets shorter than **16 bytes** are refused at mint time
  (`MIN_CONSENT_SECRET_BYTES`; deploy guidance asks for 32+ characters). The Worker surfaces
  this as `503 consent_secret_too_weak`.
- Tokens longer than **4096 bytes** are rejected before any decode/HMAC work
  (`MAX_CONSENT_TOKEN_LENGTH`).
- Signature comparison is **timing-safe**; both base64url segments must be **canonical**
  (malleable trailing-bit variants are rejected as `non_canonical`).
- Verification order: shape → known key id → HMAC → payload encoding/schema → canonical
  JSON → expiry → site binding. Failures return a stable `reason`
  (`malformed`, `unknown_key`, `bad_signature`, `invalid_payload`, `non_canonical`,
  `expired`, `wrong_site`, …).

**Rotation.** Worker secrets `CONSENT_TOKEN_SECRET` (current) and
`CONSENT_TOKEN_SECRET_PREVIOUS` (older values) form a keyring
(`keyringFromSecretValues`); values may carry an explicit `k<N>.` prefix (e.g.
`k2.<secret>`), and plain values map to `k1`. New tokens are signed with the current key;
tokens under previous keys stay valid until their TTL.

> **Boundary note (ADR-010).** This is the **community** token: an HMAC envelope, minted
> and verified only inside your Worker. It is *not* the licensed Consent Evidence Token
> Standard (CETS v1.1) — witnessed records, `record_id`, and proof anchors are Attestrue
> extensions; see the pointer in
> [`CONSENT-EVIDENCE-TOKEN-STANDARD.md`](../CONSENT-EVIDENCE-TOKEN-STANDARD.md). Normative
> CETS text is licensed and intentionally not reproduced here.
