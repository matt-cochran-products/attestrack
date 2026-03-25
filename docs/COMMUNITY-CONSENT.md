# Community consent and the premium extension point

Attestrack’s **public core** includes a **real** community consent path: operator-owned **`ConsentConfig` in KV**, mandatory Worker strategies (`jurisdiction`, `consent`, `evidence-unsigned`), HMAC privacy consent tokens (`@attestrue/sdk`), and **`@attestrue/consent-js`** (banner, GPC, token coordination, script gating — implemented over time; contracts ship first).

This is **not** the attorney-maintained regulation database. That capability is the **Privacy Consent** add-on. The upgrade is a **swap of strategy implementation**, not a second stack.

## Community tier (open source)

| Piece | Role |
| --- | --- |
| `packages/consent-js` | First-party script: UI, GPC, token minting, script blocking (stub → full implementation). |
| **JurisdictionStrategy** (`jurisdiction`) | Reads **`ConsentConfig`** from operator KV; maps request signals to a jurisdiction row. |
| **Consent gate** (`consent`) | Worker: verify HMAC token from first-party cookie (`at_consent` via `createConsentCookieStrategy`); GPC enforcement and mint path align with `consent.js` as implementation lands. |
| **EvidenceUnsignedStrategy** (`evidence-unsigned`) | Writes flat **`ConsentEventRecordV1`** (self-attested operational record). |

**`ConsentConfig`** shape: `@attestrue/types` + `consentConfigSchema` in `@attestrue/schema`. Defaults for copy/paste: `COMMUNITY_DEFAULT_CONSENT_CONFIG` and `packages/consent-js/templates/community-default-consent-config.json`.

- **Jurisdiction keys:** free-form strings (e.g. `EU`, `DEFAULT`). For US subdivisions, use ISO-style codes from **`US_STATE_AND_DC_ISO_CODES`** (`US-CA`, …, `US-DC`); add only the rows you need to `jurisdictions` — the default object does not enumerate every state.
- **IOA:** each row uses **`ioa_assertions`**, an array of `{ id, text, required? }`. One entry behaves like the old single `ioa_text`; multiple entries model **several required checkboxes** (e.g. privacy + terms + marketing).
- **Regulations:** optional **`applies_regulations`** on each row holds slugs (see **`COMMON_REGULATION_FRAMEWORK_IDS`** in `@attestrue/types` / `regulation.ts`) for portal labeling and premium matrix joins — not a legal classification API.

**Honest positioning:** community defaults are functional starting points, not counsel-reviewed law. Operators maintain their own KV document unless they buy the add-on.

## Premium tier (Privacy Consent add-on)

| Piece | Role |
| --- | --- |
| **JurisdictionCompleteStrategy** | Same pipeline slot as **JurisdictionStrategy**; sources rows from Attestrue’s attorney-maintained regulation service and writes the **same KV document shape** (or the same key) on the customer’s behalf. |

### `StrategyManifest.replaces`

Premium strategies ship with a manifest that includes:

```ts
replaces: ['jurisdiction']
```

When the **CDN loader** merges bundled strategies with signed extension strategies, any bundled strategy whose **`id`** appears in **`replaces`** is **removed**; the extension runs in its place. The Worker binary, KV binding, and schema do not change — typically a **single environment flag** enables the extension bundle.

Resolution helper: `resolveStrategiesWithReplaces` in `@attestrue/sdk`.

## One-sentence upgrade path

**Community:** you own **`ConsentConfig`** in KV. **Privacy Consent add-on:** Attestrue maintains that config for you, attorney-supervised and updated after rulings — same infrastructure, same KV contract, no redeploy of customer plumbing.
