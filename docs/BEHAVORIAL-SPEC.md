# Attestrack — Behavioural Specification

**Version 1.2 — March 2026**
**Status: Authoritative Reference**
**Amended per Architecture Change Specification v9.2 (March 2026)**
**Scope: CLI deployment tool · Community portal · Worker runtime (community tier) · Analytics layer**
**Audience: Product · Engineering · Design**

**v1.3 changes (ADR-010):** Open-source **Attestrack** portal is **analytics-first**; consent/evidence/banner/policy/counsel **UI** is **not** specified here — use **Extensions** handoff and licensed product docs. **CE.*** and **EV.*** parts below remain **historical** reference for eventual licensed portal parity; community implementation defers to `/extensions`.
**v1.2 changes:** Evidence disclaimer (**EC.1**) aligned with RFC 8785 **`record_id`**, Attestrue **`/verify`**, and **dual public `proof-anchors`** daily JSON (no Merkle / blockchain wording). **STR.1** and portal copy distinguish **Privacy Consent**, **Proof**, **Operating Agreement**, **Acknowledgment**, and dependencies per v9.2 §3.4–3.5. **CE.6** domain-scoped presentation for **`privacy_consent`** vs agreement/acknowledgment flows. Prior v1.1 analytics/migration/upgrade renumbering unchanged.

**v1.1 changes:** Added Part IX — Analytics Dashboard Behaviours. Added Part X — Explore Behaviours. Renumbered Part X (Migration) to Part XI, Part XI (Upgrade) to Part XII, Part XII (Invariants) to Part XIII. Added four analytics invariants to the invariants table. Added Appendix A (Analytics implementation strategy).

---

## Preamble

This document specifies what Attestrack does from the user's perspective. It is declarative — it asserts outcomes and behaviours, not mechanisms. It does not specify implementation, data structures, or technical architecture. Those are specified in the Repo Spec and the Core ConOps.

Behaviours are stated as assertions. Each assertion is either satisfied or not by the implementation. An implementation that satisfies all assertions in this document is a correct Attestrack implementation.

This spec covers three surfaces: the deployment CLI, the community portal, and the Worker runtime as observable from the portal. It does not cover the Worker internals (strategy execution model, evidence chain construction) — those are in the Core ConOps.

---

## Part I: Deployment CLI Behaviours

### CLI.1 — Single entry point

The entire deployment is initiated by a single command with no required flags. Running `npx @attestrue/deploy` with no arguments starts the interactive setup. No other command is required for a complete deployment.

### CLI.2 — Guided, not assumed

The CLI asks for information it cannot determine automatically. It does not ask for information it already knows. If the user is already authenticated with Cloudflare, the CLI does not ask them to authenticate again — it confirms their identity and proceeds.

### CLI.3 — Sequential steps, visible progress

Each step of the deployment is presented and completed before the next step begins. The user always knows which step they are on and how many remain. Progress is not hidden or deferred to a progress bar that runs silently for minutes.

### CLI.4 — Recoverable errors

When a step fails, the CLI explains what went wrong in plain language, states whether the error is recoverable, and offers to retry. The CLI does not terminate on a recoverable error without offering the user a path forward. The CLI does not continue past an unrecoverable error.

### CLI.5 — Credentials masked

All credential input is masked at the terminal. Credentials are not echoed, not written to stdout, and not written to any log file. Credentials are stored as Cloudflare Worker secrets, not as plain text environment variables.

### CLI.6 — All Cloudflare resources created in the user's account

The CLI creates resources (Worker, KV, D1, R2, Pages) in the user's own Cloudflare account. The CLI does not create resources in any Attestrue-controlled account. The user retains full ownership and control of every resource created.

### CLI.7 — Portal deployed and accessible after CLI completes

When the CLI completes successfully, the portal is accessible at the URL displayed in the completion output. The user does not need to perform any additional deployment steps to access the portal.

### CLI.8 — DNS instructions are human-readable

The CLI provides DNS configuration instructions in plain language. It shows the exact CNAME record to create, where to create it, and what the result will be. It does not require the user to understand DNS propagation timing but tells them to wait up to 24 hours for propagation.

### CLI.9 — Script tag instructions are copy-paste ready

The CLI provides the exact script tag to add to the site's `<head>`, with the user's specific subdomain already substituted. The user does not need to modify the tag. It is ready to copy and paste.

### CLI.10 — Deployment starts in shadow mode

Every new deployment starts in shadow mode. The CLI does not offer an option to start in enforcement mode. The completion output explains shadow mode and what it means.

### CLI.11 — Re-runnable for updates

Running the CLI against an existing deployment (same `SITE_ID`) updates the deployment rather than creating a duplicate. The CLI detects the existing deployment and presents the user with a diff of what will change before proceeding.

### CLI.12 — No Attestrue account required for deployment

The CLI completes a full community deployment without requiring a user account on attestrue.com. The only required account is the user's Cloudflare account. The upgrade path is a URL, not a registration gate.

---

## Part II: Portal Behaviours — General

### PORTAL.1 — Authentication by Cloudflare Access only

The portal does not implement its own authentication. Access to the portal is controlled by the Cloudflare Access policy configured during deployment. A user who can access the portal URL is authenticated. There is no login screen in the portal.

### PORTAL.2 — All data from the customer's own infrastructure

Every piece of data displayed in the portal comes from the customer's own Cloudflare KV, D1, or R2. The portal makes no calls to Attestrue infrastructure during normal operation. The portal does not transmit any customer data to Attestrue.

### PORTAL.3 — Mode indicator always visible

The current deployment mode (shadow or enforcement) is displayed in the portal shell on every screen. It is never hidden, collapsed, or absent when a page is loaded. The mode indicator is amber for shadow mode and green for enforcement active.

### PORTAL.4 — Unsigned records consistently labeled

Every community evidence record is labeled as unsigned wherever it appears in the portal. The label is "Unsigned — locally generated record" or equivalent. The portal does not present unsigned records as independently verified. The distinction between unsigned community records and signed proof layer records is explained wherever the distinction is relevant.

### PORTAL.5 — Write operations require confirmation

Every operation that modifies configuration or publishes data requires an explicit confirmation step. Read operations require no confirmation. Confirmation is proportional to the severity of the action:

- Low-severity changes (adjusting a gate trigger, updating analytics credentials): a confirmation button
- Medium-severity changes (publishing a new policy version, updating banner configuration): a diff display plus confirmation button
- High-severity changes (switching enforcement mode, disabling a strategy): a typed confirmation phrase

### PORTAL.6 — Destructive actions require typed confirmation

Actions that cannot be undone (switching from enforcement to shadow mode, disabling an active strategy) require the user to type a specific phrase. The phrase is shown to the user — they do not need to remember it. The action does not proceed unless the typed phrase matches exactly.

### PORTAL.7 — Changes are logged

Every configuration change made through the portal is recorded as an event in the evidence chain. The event includes what changed, when it changed, and the CF Access identity of the user who made the change. This log is append-only.

### PORTAL.8 — Empty states are actionable

Every view that can have an empty state (no events yet, no alerts, no policy versions published) displays a helpful message and a clear next step. Empty states do not display blank screens or generic "no data" messages.

### PORTAL.9 — Upgrade prompt appears in two places only

The **Attestrue extensions** upgrade CTA appears in two places: the Evidence Chain view (where the unsigned/signed distinction is most relevant) and the persistent shell indicator at the bottom of the navigation. It does not appear on every screen. It does not use urgency language. It does not appear as a modal or interstitial.

### PORTAL.10 — No data leaves the customer's account through the portal

The portal upgrade page links to `attestrue.com/upgrade?site_id={site_id}`. This is the only outbound link to Attestrue infrastructure in the portal. All other portal operations are contained within the customer's own CF account.

---

## Part III: Dashboard Behaviours

### DASH.1 — Dashboard loads within current data

The dashboard displays data from the last 7 days by default. It does not require a full historical data load to render. The time range is selectable.

### DASH.2 — Four metric cards always present

The dashboard always displays four metric cards: consent rate, events today, active drift alerts, and strategy status. Cards that have no data yet show a zero or "—" state with an explanation, not an error.

### DASH.3 — Consent rate is always contextualised

The consent rate metric is always shown alongside its comparison period (e.g., "↑ 2.1% vs last 7 days") and the enforcement context ("Shadow mode — this would be the enforced rate"). It is never shown as a bare percentage without context.

### DASH.4 — Drift alerts are surfaced immediately

If any active drift alerts exist, they appear on the dashboard above the charts. They are not buried in a separate tab. Each alert shows: what was detected, when it was first detected, the number of affected requests, and a link to the relevant configuration view.

### DASH.5 — Recent events are real-time within session

The recent events panel on the dashboard updates without requiring a page refresh during an active session. New events that arrive while the dashboard is open appear in the panel.

---

## Part IV: Consent Events Behaviours

### CE.1 — Full event history accessible

Every consent event recorded since the deployment's first event is accessible. The view is paginated. There is no data retention limit in the community tier for event log access — all events stored in the customer's D1 are accessible.

### CE.2 — Filters are additive

Applying multiple filters (date range, jurisdiction, decision type) narrows the result set by intersection. Filters are not mutually exclusive. All active filters are visible and individually removable.

### CE.3 — Event detail is complete

Clicking any event row shows the complete event payload — every field that was recorded. No fields are hidden or truncated in the detail view except hash values, which are truncated with the full value accessible on hover.

### CE.4 — Policy version linkage

Every event that includes a policy version hash links to the policy version view for that specific version. The user can navigate from a consent event to the exact policy text the visitor was shown.

### CE.5 — Consent rate analysis is per applicable regulation

The consent rate analysis sub-view (licensed portal) shows rates broken down by **applicable regulation** (via mapping from geo/signal — technical **jurisdiction** keys may still label rows). It does not show a single global rate that averages across regimes with different requirements. **Regulation-aware** configuration is delivered by the **Privacy Consent** licensed add-on — not by open-source Attestrack alone.

### CE.6 — Domain-scoped evidence presentation

Where the portal surfaces consent or agreement records, filters and explanatory copy respect **consent domain**: **`privacy_consent`** (regulation-driven banner and post-consent tracking rules) vs **operating agreement** (`terms_acceptance`, `nda`, `subscription`) vs **acknowledgment** (`policy_acknowledgment`, `hr_receipt`). Marketing / ad-network strategies and post-consent tracking analytics apply to **privacy-domain** outcomes; non-privacy domains are **record-only** for those strategies. The portal must not imply that **Proof** includes **Operating Agreement** or **Acknowledgment** product surfaces without those separate add-ons (Proof is prerequisite only).

---

## Part V: Evidence Chain Behaviours

### EC.1 — Honest framing at all times

The Evidence Chain view always displays the unsigned record disclaimer at the top of the view. The disclaimer is present on every load of the view. It explains what is absent for the **community** tier: **independent Attestrue witness** (Ed25519 proof / **`/verify`** path), **CTaaS ledger** row, and **daily `proof-anchors`** commitment that ties the event’s **`record_id`** into the public anchor files — i.e. Steps 2–3 of the licensed **trust chain** (CETS v1.1). It does **not** use Merkle-tree or blockchain wording. **Step 1** (RFC 8785 content integrity on a canonical document) may still apply where a self-attested canonical file exists; the disclaimer makes clear there is no **paid Proof** witness bundle in OSS-only deployments.

### EC.2 — Local integrity check on every record

Each evidence record displays the result of a local integrity check: the portal recomputes the hash of the stored payload and compares it to the stored hash. The result is displayed as ✓ (matches) or ✗ (tampered). A mismatch is surfaced as an alert, not silently ignored.

### EC.3 — Record types are distinguished

The evidence chain contains records of multiple types: consent events, configuration change events, token destruction events, drift alert events, and strategy change events. Each record type is visually distinguished in the list view. The user can filter by record type.

### EC.4 — Configuration change history is accessible

The full history of every configuration change — banner configuration, policy version publication, strategy enable/disable, enforcement mode changes — is accessible in the evidence chain. Point-in-time queries ("what was the active configuration on March 1?") are answerable from this view.

### EC.5 — Community TIR is clearly scoped

When the user generates a community TIR, the document's cover page states that it is an unsigned community record unsuitable for use in legal proceedings. This statement is present in every community TIR and cannot be removed or suppressed.

---

## Part VI: Strategies Behaviours

### STR.1 — All strategies shown, locked strategies explained

Every available strategy is shown in the strategies view — both community strategies and strategies **gated by licensed add-ons**. Locked rows state what they do and **which add-on** unlocks them, per v9.2 §3.4–3.5: **Privacy Consent** (regulation database, counsel-ready configuration above floor); **Proof** (independent witness, **`record_id`**, proof blob, ledger, dual Git anchor — **witnessing only**, not ToS/HR/agreement UX); **Operating Agreement Consent** and **Acknowledgment Consent** (**separate** SKUs, each **requires Proof**); **Attorney overlay** (**requires Privacy Consent + Proof**); **Banner Intelligence** (**requires Privacy Consent**). They do not show price or sales pitch — factual description and a single extensions handoff link.

### STR.2 — Enabling a strategy requires credential confirmation

Enabling a strategy that requires credentials (all ad network strategies) requires the user to enter or confirm the credentials before the strategy activates. A strategy cannot be enabled with blank or placeholder credentials.

### STR.3 — Disabling a strategy requires typed confirmation

Disabling an active ad network strategy requires typing the strategy name. The portal explains that disabling a strategy means events stop flowing to that destination immediately.

### STR.4 — Strategy errors are surfaced

If a strategy returns errors (authentication failure, network timeout, invalid payload), those errors are visible in the strategy detail view. The error count is shown on the strategy card in the strategy list. Errors are shown with enough context to diagnose the cause (e.g., "Meta CAPI returned 401 — check access token validity").

### STR.5 — Community strategy submissions link to GitHub

The strategies view includes a link to the community strategy submission process on GitHub. It does not describe an in-portal submission flow — community strategies are submitted as pull requests to the open source repo.

---

## Part VII: Banner Configuration Behaviours

### BAN.1 — Current configuration always shown before editing

The banner configuration view shows the currently active configuration before offering any edit controls. The user sees what is deployed before they see any edit affordances.

### BAN.2 — Changes are previewed before publishing

Every change to the banner configuration can be previewed before publishing. The preview shows a visual representation of what a visitor will see. The preview updates as the user makes changes, without requiring them to publish a draft first.

### BAN.3 — IOA checkbox cannot be disabled

The IOA attestation checkbox is a required element of the consent gate. The portal does not offer any configuration option that would result in the acceptance flow working without the IOA checkbox. The IOA attestation is a behavioural invariant of the system.

### BAN.4 — Reject All cannot be hidden

The banner configuration editor does not offer any setting that would hide or deprioritise the Reject All option. If a configuration would result in the Reject All path being less prominent than the Accept path, the portal displays a warning and requires explicit acknowledgment before publishing.

### BAN.5 — Attestation text reflects disclosure documents

When the user adds or removes a disclosure document from the configuration, the IOA attestation text automatically updates to include or exclude the document label. The user can customise the attestation text, but the default always reflects the configured documents accurately.

### BAN.6 — Version history is accessible

Every previously published banner configuration is stored and accessible in the version history view. Each version shows a diff from the preceding version. Any previous version can be restored.

---

## Part VIII: Policy Version Behaviours

### POL.1 — No enforcement without policy versions

The portal does not allow the user to activate enforcement mode if no policy versions have been published. The enforcement toggle is disabled with an explanation until at least one privacy policy version and one terms of use version exist.

### POL.2 — Publishing a version hashes the text immediately

When the user publishes a new policy version, the hash is computed from the exact text they entered and displayed to them immediately after publication. The user can verify the hash independently.

### POL.3 — Past versions are immutable

Once a policy version is published, its text cannot be edited. A new version must be published to change the policy. The previous version remains in history unchanged.

### POL.4 — Consent event linkage is accurate

The policy version displayed in a consent event's detail panel is the version that was active at the time of the event — not the current active version. If the policy has been updated since the event, the event still shows the original version.

### POL.5 — Hash verification is self-explanatory

The policy version view includes instructions for independently verifying the hash. A user who follows these instructions can confirm that the stored hash matches the stored policy text without any Attestrue involvement.

### POL.6 — Unsigned status is labelled

Community policy versions are labelled as "unsigned — client-published" in every context where they appear. The portal explains that unsigned versions are self-attested: the hash was computed and stored by the customer's own system. Independent counsel-signed versions require the proof layer.

---

## Part IX: Site Configuration Behaviours

### CFG.1 — Shadow/enforcement toggle requires explicit ceremony

Switching between shadow mode and enforcement mode requires a typed confirmation. The portal explains what will change before the confirmation is requested. The explanation is specific: "Enforcement mode means visitors who decline consent will not have tracking scripts activated. Your reported consent rate will reflect actual signal sent to ad networks."

### CFG.2 — Shadow mode is always reversible

Enforcement mode can always be switched back to shadow mode. The portal does not present enforcement as a one-way door. Returning to shadow mode carries the same typed confirmation requirement as activating enforcement.

### CFG.3 — Trusted domains list is explicit

The third-party egress allowlist (which domains receive data in State 3) is shown explicitly. The user can see every domain that will receive data post-consent. Adding a domain requires confirmation. Removing a domain requires confirmation.

### CFG.4 — Configuration reads match Worker runtime

The configuration displayed in the portal is the configuration the Worker is actively using. There is no "pending" or "draft" state between portal configuration and Worker execution — published configuration is immediately active.

---

## Part IX: Analytics Dashboard Behaviours

### ANA.1 — Analytics is the primary entry point for data analysts

The Analytics section of the portal is the first destination for a user whose primary task is understanding tracking performance. The information architecture leads with Signal Recovery, not with consent events or evidence chain. A user who deploys Attestrack to recover ad signal lands on data relevant to that problem immediately.

### ANA.2 — Curated views answer specific questions without configuration

Every view in the Analytics Dashboard is pre-configured. A user who opens the Signal Recovery view sees a populated chart immediately — they do not configure a data source, select fields, or build a query. The view is the answer to a specific question the product already knows to ask.

The curated questions answered by the Analytics Dashboard are:
- How many events were recovered from ad blockers in the selected period?
- How many events were recovered from ITP / browser tracking restrictions?
- What percentage of converting users converted more than 7 days after first visit — the attribution window that browser-side tracking loses?
- What is the consent rate by jurisdiction over time?
- What is the success rate per destination, and are any destinations failing?
- What is the bot detection rate and what signals are triggering it?

### ANA.3 — All analytics data comes from the customer's own ClickHouse

Every chart in the Analytics Dashboard queries the customer's own ClickHouse or Tinybird instance via the portal's query proxy. No analytics data is stored in or transmitted to Attestrack infrastructure. If the customer has not configured a ClickHouse destination, the Analytics Dashboard shows an empty state with instructions to configure one.

### ANA.4 — Curated views are read-only

Users cannot modify the curated dashboard views. They can filter by date range and, where relevant, by jurisdiction or destination. They cannot add, remove, or reorder the pre-built charts. Customisation belongs in the Explore surface.

### ANA.5 — Date range applies globally within a session

When the user selects a date range on any Analytics Dashboard view, that range applies to all views for the duration of the session. They do not need to set the date range on each chart individually.

### ANA.6 — Charts load independently

Each chart on the Analytics Dashboard loads its data independently. A slow query on one chart does not delay other charts from rendering. Charts show a loading state while their query is running and a result or error state when it completes.

### ANA.7 — Signal recovery numbers are clearly framed

The signal recovery metrics (events recovered from ad blockers, events recovered from ITP) include a brief explanatory label that tells the user what "recovered" means. These are not bare numbers. A number shown without context that the user cannot interpret is not useful. The label is short — one line — but always present.

---

## Part X: Explore Behaviours

### EXP.1 — Explore is a SQL editor connected to the customer's ClickHouse

The Explore surface presents a SQL editor. The user writes standard SQL. The query runs against the customer's own ClickHouse instance via the portal's read-only query proxy. The user sees results in a table. They optionally visualise the results as a chart.

### EXP.2 — The connection is pre-configured

The user does not configure a data connection in Explore. The portal already has the ClickHouse connection from deployment configuration. Explore inherits that connection. The user writes SQL immediately without any setup step.

### EXP.3 — Queries are read-only, enforced server-side

The query proxy enforces read-only access. Only `SELECT` statements are permitted. Any query containing `INSERT`, `UPDATE`, `DELETE`, `DROP`, `CREATE`, `ALTER`, or any other write or schema-modification statement is rejected before execution. This enforcement happens in the Worker, not in the frontend. A user cannot bypass it by manipulating the request.

### EXP.4 — Queries are scoped to the Attestrack schema

The query proxy enforces a table allowlist. Queries may only reference tables that are part of the Attestrack event schema. A user cannot access other tables in the customer's ClickHouse instance through the Explore interface. This prevents accidental or deliberate access to non-tracking data in the same ClickHouse instance.

### EXP.5 — Row limit is enforced server-side

The query proxy enforces a maximum row count on all queries. The default limit is 10,000 rows. If a query would return more rows, the proxy appends or replaces the `LIMIT` clause to cap the result at 10,000. The user is informed when their result was truncated.

### EXP.6 — Schema autocomplete is available

The SQL editor provides autocomplete for table names and column names from the Attestrack event schema. The user types `SELECT ` and sees available columns. They type `FROM ` and see available tables. Autocomplete works without the user needing to know the schema in advance.

### EXP.7 — Results are displayed as a table before any visualisation

Query results are shown as a data table first. The table supports column sorting, basic filtering, and pagination. Visualisation is optional and additive — the user can always see the raw result regardless of whether they choose to chart it.

### EXP.8 — Visualisation is user-directed, not automatic

The portal does not automatically choose a chart type for a query result. The user explicitly chooses to visualise a result and selects the chart type. The available chart types are: line, bar, scatter, pie, area, heatmap, and table (the default). The portal does not infer which chart type is most appropriate.

### EXP.9 — Saved queries are stored in the customer's own CF KV

When a user saves a query, it is written to the customer's CF KV. It is not stored in any Attestrack or Attestrue system. A customer who stops using Attestrack retains their saved queries in their own CF KV indefinitely.

### EXP.10 — Saved queries can be pinned to the Analytics Dashboard

A saved query with a pinned chart configuration appears as a tile on the user's Analytics Dashboard alongside the pre-built curated views. Pinned saved queries are personal to the user who created them — they are not shared with other portal users by default.

### EXP.11 — Query results can be exported as CSV

The user can download any query result as a CSV file from the results table. The CSV is generated in the browser from the result data — it is not routed through any Attestrack or Attestrue server. The CSV contains only the data the query returned.

### EXP.12 — No query content is transmitted to Attestrack

The portal's query proxy passes the SQL string to the customer's ClickHouse directly. The Worker API endpoint that proxies the query does not log, store, or transmit the query string or results to any Attestrack or Attestrue system. Query content is between the user and their own ClickHouse.

### EXP.13 — Explore is unavailable without a configured analytics destination

If the customer has not configured a ClickHouse or Tinybird destination, the Explore surface shows an empty state explaining that an analytics destination is required. The empty state links to the Strategies configuration view where the destination can be configured. The SQL editor does not appear until a connection is available.

---

## Part XI: Migration Wizard Behaviours

### MIG.1 — Wizard is non-destructive

The migration wizard provides guidance and generates configuration. It does not make changes to the user's existing CMP, tracking stack, or DNS without explicit user action at a confirmation step. Following the wizard does not modify any production system until the user explicitly chooses to proceed.

### MIG.2 — Shadow mode validation is built into the migration path

Every migration path includes a shadow mode validation phase where Attestrack runs alongside the existing system. The wizard does not recommend cutover until the user has completed this phase and confirmed parity.

### MIG.3 — Cutover is a checklist, not a button

The migration cutover step is a checklist of actions the user takes in their existing system (removing the old pixel, removing the old script tag, disabling the old CMP). It is not a single button in the Attestrack portal. The user takes these actions in their own systems and marks them complete.

---

## Part XII: Upgrade Page Behaviours

### UPG.1 — No API calls from the upgrade page

The upgrade page is static. Loading the upgrade page makes no calls to Attestrue infrastructure. No customer data is transmitted by loading this page.

### UPG.2 — Site ID pre-populated in upgrade link

The upgrade link from the portal includes the customer's `site_id` as a query parameter. This is the only data transmitted to Attestrue via this path. It allows the Attestrue signup flow to pre-identify the existing deployment.

### UPG.3 — Upgrade does not require redeployment

The upgrade page explains that activating licensed Attestrue extensions does not require redeploying the Worker. The customer adds a license key to their existing deployment and entitled add-ons activate on the next Worker restart. Existing unsigned records remain unchanged. New **Proof**-eligible records receive independent witnessing from activation onward.

---

## Part XIII: Behavioural Invariants

These are absolute behavioural constraints that cannot be overridden by any configuration, by any user action, or by any future product decision without explicit revision of this document.

| Invariant | Statement |
|---|---|
| INV-B-01 | The portal never transmits customer event data to Attestrue |
| INV-B-02 | The portal never calls Attestrue APIs during normal operation |
| INV-B-03 | New deployments always start in shadow mode |
| INV-B-04 | Enforcement mode cannot be activated without published policy versions |
| INV-B-05 | Unsigned community records are always labeled as unsigned |
| INV-B-06 | The IOA checkbox cannot be disabled or made optional |
| INV-B-07 | The Reject All path cannot be hidden or deprioritised by portal configuration |
| INV-B-08 | Every configuration change is logged to the evidence chain |
| INV-B-09 | Past policy versions cannot be edited after publication |
| INV-B-10 | The CLI never writes credentials to any log file or stdout |
| INV-B-11 | All Cloudflare resources are created in the customer's account, not Attestrue's |
| INV-B-12 | The upgrade page is static and makes no API calls |
| INV-B-13 | Community TIRs always include the unsigned disclaimer |
| INV-B-14 | Analytics queries are enforced read-only at the Worker proxy layer, not only in the frontend |
| INV-B-15 | Analytics queries are scoped to the Attestrack schema allowlist — cross-table access to non-Attestrack data in the same ClickHouse instance is not permitted |
| INV-B-16 | Query content and results are never transmitted to Attestrack or Attestrue infrastructure |
| INV-B-17 | Saved queries are stored in the customer's own CF KV — not in any Attestrack system |

---

## Appendix A: Analytics Implementation Strategy

*This appendix documents the recommended technical approach for the analytics layer. It is a strategy-level reference — the specific stack recommendation agreed at the product level — not a binding implementation spec. The implementation spec belongs in the repo spec. This appendix exists so the reasoning and the choices are visible alongside the behaviours they enable.*

### Why not an embedded BI component

The obvious approach is to embed a third-party BI component — Graphic Walker, Metabase, or similar — and configure it to query the customer's ClickHouse. This approach was evaluated and rejected for two reasons.

**Licensing.** Components that support server-side query pushdown to ClickHouse are commercially licensed for that capability. Graphic Walker's React component is MIT licensed for client-side use. Its ClickHouse query pushdown is an enterprise feature requiring Kanaries Cloud infrastructure. Using the open source code to understand the computation interface pattern is appropriate; using their commercial pushdown is not.

**Architecture fit.** The portal already has a Worker API, already stores the ClickHouse credentials, and already knows the event schema. The query proxy pattern — adding a `/api/portal/analytics/query` endpoint to the existing Worker API — achieves the same capability with no external dependency, no licensing concern, and no data leaving the customer's infrastructure. An embedded third-party component that processes queries would receive customer tracking data, which directly contradicts the core Attestrack value proposition.

### Recommended frontend stack

**Curated dashboard charts:** Recharts (MIT). React-native declarative components. Handles time-series and categorical charts well. The right choice for the pre-built signal recovery, consent rate, and destination health views where the data shape is known in advance.

**Explore chart rendering:** Apache ECharts via echarts-for-react (Apache 2.0 / MIT wrapper). Richer chart type library than Recharts — handles scatter, heatmap, sankey, and funnel charts useful for attribution and conversion analysis. Canvas-based rendering performs better than SVG at the result set sizes typical of tracking queries.

**SQL editor:** CodeMirror 6 (MIT). The standard embeddable SQL editor with syntax highlighting, autocomplete, and ClickHouse SQL dialect support via the community extension. Used in production by VS Code, Replit, and most web-based database tools.

**Results table:** TanStack Table v8 (MIT, formerly react-table). Headless table component providing sorting, filtering, pagination, and column resizing without imposing styling. Renders with the Attestrue design system.

**Chart type selector:** Built with Attestrue design system components. Not a third-party component.

### The query proxy

The Worker API gains one new internal endpoint. This endpoint is the entire analytics infrastructure — no additional service, no additional deployment.

The endpoint accepts a SQL string, validates it (SELECT only, schema allowlist, row limit), executes it against the customer's ClickHouse using the already-stored credentials, and returns the result set as JSON. The validation is a conservative string-level check — when in doubt, reject.

The endpoint does not log query content. It does not transmit results to Attestrack infrastructure. It is a transparent proxy between the portal frontend and the customer's own ClickHouse.

### Why not Grafana

Grafana is the natural comparison. The reason not to embed or bundle Grafana is deployment architecture: Grafana requires a separate server with its own database, authentication, and configuration. The portal is a CF Pages static SPA. These are incompatible deployment models.

Users who want Grafana's full feature set — alerting, provisioned dashboards, team sharing, plugin ecosystem — can connect Grafana directly to their ClickHouse using the official ClickHouse Grafana plugin. This is encouraged, not competed with. The portal analytics layer handles 80% of daily tracking analysis questions. Grafana handles the remaining 20% for teams who need it.

### The Graphic Walker pattern — what is learned, not licensed

Graphic Walker's open source code demonstrates the computation interface pattern: how to separate query definition (what the user specifies in the chart builder) from query execution (what runs against the database) from result rendering (what the chart component receives). This pattern is well-implemented in their open source code and is worth studying as a reference architecture.

The Attestrack implementation follows this separation: CodeMirror handles query definition, the Worker proxy handles execution, Recharts/ECharts handle rendering. The separation is the same. The implementation is independent and does not use any Graphic Walker code.

---

*Version 1.2 — March 2026 (Architecture Change Spec v9.2)*
*Supersedes version 1.0 and 1.1*
*Proposed changes to any behavioural invariant require explicit revision of this document*
*Companion documents: Portal Community Spec v1.0 · Portal Community Tracking Features Spec v1.0 · User Journey Spec v1.2 · Core ConOps v8.0 · Repo Spec v2.1 · Architecture Change Spec v9.2*