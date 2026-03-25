# Attestrack — User Journey Specification

**Version 1.3 — March 2026**
**Status: Authoritative Reference**
**Amended per Architecture Change Specification v9.2 (March 2026)**
**Scope: Discovery through working Attestrack deployment · Analytics and data exploration · Extensions for consent/regulation (licensed)**
**Audience: Product · Engineering · Design**

**v1.3 changes (ADR-010):** Open-source journey centers on **analytics + server-side measurement**; **consent enforcement and regulation UI** are **Attestrue extensions**, not shipped from the public repo. Narrative stages that describe in-portal consent configuration remain **reference** for the licensed product.
**v1.2 changes:** **Stage 9** reflects composable add-ons — **Privacy Consent** and **Proof** each **$249/mo**, **Privacy + Proof** bundle **$449/mo**; **Operating Agreement** / **Acknowledgment** are **separate** add-ons (**$99/mo** each) with **Proof** prerequisite only — not bundled into Proof. Regulation-first demand-letter framing. Prior v1.1 analytics stages unchanged.

**v1.1 changes:** Added User C (Data Analyst). Added Stage 5a (Analytics orientation). Added Stage 8a (Analytics and explore usage). Added Appendix A (Analytics implementation strategy). Updated portal information architecture in Stage 5. Updated journey summary table.

---

## Preamble

This document specifies the user journey for Attestrack — from discovery through a working **analytics** deployment and portal use; **consent and regulation** flows continue in **Attestrue extensions** when activated.

This is a declarative specification. It describes what the user experiences and what outcomes are achieved at each stage. It does not specify implementation, component architecture, or technical mechanism.

The journey is designed for two distinct user types who arrive with different starting contexts and different levels of technical comfort. Both must reach the same destination — a working deployment — without diverging into separate products.

---

## User Types

**User A — Developer**
Arrived via GitHub, Hacker News, or a developer community. Has a Cloudflare account. Comfortable with the terminal. Wants to understand the system before deploying it. Will read the README and the strategy code before running anything.

**User B — Operator**
Arrived via the Attestrue website, a referral from a colleague, or a demand letter conversation. Has access to a Cloudflare account (possibly managed by their developer). Not comfortable with the terminal. Wants the tracking infrastructure running and manageable without developer involvement after initial setup.

**User C — Data Analyst**
Arrives after the deployment is running, introduced by User A or User B. Has ClickHouse or Tinybird credentials. Comfortable writing SQL. Wants to query the tracking data for attribution, funnel analysis, and ad performance questions — without needing a separate BI tool or sending data to a third party. Will become the heaviest daily portal user once enforcement is active and data is flowing.

All three users share the same portal. User A and User B complete the deployment journey. User C enters at Stage 5a after data is flowing.

---

## Journey Overview

```
Stage 1:  Discovery and evaluation
Stage 2:  Pre-deployment decision
Stage 3:  Deployment
Stage 4:  Validation in shadow mode
Stage 5:  Portal orientation
Stage 5a: Analytics orientation (User C entry point)
Stage 6:  Configuration
Stage 7:  Enforcement activation
Stage 8:  Ongoing operation
Stage 8a: Analytics and data exploration (ongoing, parallel to Stage 8)
Stage 9:  Upgrade consideration (optional, demand-triggered)
```

---

## Stage 1: Discovery and Evaluation

### Entry points

The user arrives from one of five sources:

**1a. GitHub** — User A discovers the repo via a search, a star from someone they follow, or an HN post. They land on the repository README.

**1b. HN / developer community** — User A reads a post or comment describing Attestrack. They follow a link to either the GitHub repo or attestrack.com.

**1c. attestrack.com** — User B arrives from a referral, a search for "server-side tracking Cloudflare", or from reading about a competitor. They land on the Attestrack marketing page.

**1d. attestrue.com** — User B arrives searching for CIPA compliance or demand letter response help. They read about Attestrack as the free foundation and follow a link to attestrack.com.

**1e. Referral** — Either user type arrives via direct word-of-mouth from someone who has already deployed.

### What the user does in Stage 1

The user reads enough to answer three questions:

1. Does this replace what I currently pay for?
2. Is this technically credible?
3. What is the effort to deploy it?

For User A: the README, the strategy source code, and the wrangler.toml example answer all three. The evaluation is technical and self-directed.

For User B: the attestrack.com page answers questions 1 and 3. Question 2 is answered by the presence of the GitHub repo and star count — they don't read the code but they note that developers trust it.

### Stage 1 exit criteria

The user has decided to deploy. They have not yet taken any action on their infrastructure.

---

## Stage 2: Pre-Deployment Decision

### What the user does

The user makes three decisions before starting deployment:

**Decision 1: Subdomain**
They decide which subdomain will serve as the first-party tracking endpoint. Convention is `t.yourdomain.com`. This must be decided before deployment because it is baked into the DNS configuration.

**Decision 2: Which strategies to enable**
They identify which ad networks they use. This determines which environment variables they will need to gather. A user running Meta and Google needs two sets of credentials. A user running Meta, Google, TikTok, and Microsoft needs four.

**Decision 3: ClickHouse or Tinybird**
They decide whether to connect a first-party analytics destination. This is optional at deploy time but recommended. The decision is: use the ClickHouse free tier, use Tinybird, or skip for now.

### What happens with the decisions

None of these decisions are entered into a system at this stage. The user simply collects the information they will need. The deploy tool will prompt for these values.

### Stage 2 exit criteria

The user has:
- Chosen a subdomain
- Identified which ad network credentials they need
- Decided on ClickHouse / Tinybird / skip
- Has those credentials ready

---

## Stage 3: Deployment

### The deployment experience

The user runs a single command:

```
npx @attestrue/deploy
```

This starts an interactive CLI that guides them through the complete setup. The CLI is the only required developer interaction. After the CLI completes, the deployment is running and the portal is accessible.

### What the CLI does (from the user's perspective)

The CLI runs a guided setup in eight steps. At each step it asks one question, validates the answer, and proceeds. It does not ask for information it already knows or can determine automatically.

**Step 1 — Cloudflare authentication**
The CLI checks whether the user is already authenticated with Cloudflare via `wrangler`. If yes, it shows their account name and asks to confirm. If no, it opens a browser tab to the Cloudflare authentication page and waits.

**Step 2 — Site identifier**
The CLI asks: "What would you like to call this deployment?" This becomes the `SITE_ID` — a short string like "mycompany-main" or "ecommerce-prod". It cannot contain spaces. It is used to identify this deployment in evidence records and in the portal.

**Step 3 — Subdomain**
The CLI asks for the subdomain they will use (e.g., `t.yourdomain.com`). It explains that DNS must be configured after deployment but that they can proceed now. It validates that the format is a valid subdomain.

**Step 4 — Strategy selection**
The CLI presents the available strategies as a checklist. The user selects which ones to enable. For each selected strategy, the CLI asks for the required credentials. It masks credentials as they are typed. It validates that credentials are in the expected format where possible.

**Step 5 — Analytics destination (optional)**
The CLI asks whether to configure ClickHouse or Tinybird. If yes, it asks for the connection details. If no, it proceeds. Either choice can be changed later via the portal.

**Step 6 — Cloudflare resource creation**
The CLI creates the required Cloudflare resources: Worker, KV namespace, D1 database, R2 bucket. It displays each resource as it is created. It handles errors by explaining what went wrong and offering to retry or skip.

**Step 7 — Worker deployment**
The CLI deploys the Worker to the user's Cloudflare account. It displays the deployment URL (e.g., `my-site.workers.dev`).

**Step 8 — Portal deployment**
The CLI deploys the community portal to Cloudflare Pages on the same account. It configures Cloudflare Access to protect the portal route. It displays the portal URL.

### What the CLI tells the user at the end

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ Deployment complete

Your tracking Worker is running at:
  https://my-site.workers.dev

Your management portal is at:
  https://portal.my-site.pages.dev

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Two things to do before events start flowing:

1. Add a DNS CNAME record in your Cloudflare dashboard:
   Name:    t          (or whatever subdomain you chose)
   Target:  my-site.workers.dev
   Proxy:   On (orange cloud)

   This makes your tracking endpoint first-party.
   Without it, your Worker is reachable but not at your domain.

2. Add this script tag to your site's <head>:
   <script src="https://t.yourdomain.com/consent.js"></script>

   Replace yourdomain.com with your actual domain.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Your deployment is running in shadow mode.
Events are being recorded but tracking is not yet gated
on consent. This is intentional — validate first, enforce later.

Open your portal to continue:
→ https://portal.my-site.pages.dev

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### What User B does differently

If User B has a developer, the developer runs the CLI. The developer shares the portal URL with User B. From this point forward, User B operates entirely through the portal. The developer's involvement is complete.

### Stage 3 exit criteria

- Worker is deployed and running on the user's CF account
- Portal is deployed and accessible
- DNS CNAME instructions have been delivered
- Script tag instructions have been delivered
- Deployment is in shadow mode

---

## Stage 4: Validation in Shadow Mode

### What shadow mode means to the user

In shadow mode, the Worker is running and recording everything, but it is not enforcing consent — tracking scripts fire for all visitors regardless of their consent decision. This is intentional. It allows the user to:

- Verify that events are flowing correctly
- Check that all strategies are receiving data
- Confirm consent rates look reasonable before gating tracking on them
- Validate that the banner is displaying correctly

Shadow mode is the right starting point for every deployment. No deployment should start in enforcement mode.

### What the user does in Stage 4

The user adds the DNS CNAME and the script tag to their site, waits until they see events appearing in the portal dashboard, and spends between one day and two weeks in shadow mode validating their deployment.

The recommended shadow mode duration is seven to fourteen days. This gives enough data to establish a baseline consent rate and identify any configuration issues before enforcement.

### What the user sees in shadow mode

The portal dashboard shows events flowing. The consent rate panel shows what the rate would be if enforcement were active. The user can see:

- How many events are flowing per day
- What the baseline consent rate is across jurisdictions
- Whether any strategies are failing or returning errors
- Whether drift alerts have fired

The portal consistently shows the amber "SHADOW MODE" indicator in the shell. The user is never confused about whether enforcement is active.

### Stage 4 exit criteria

The user has:
- Confirmed events are flowing in the dashboard
- Reviewed the consent rate and found it reasonable
- Confirmed all active strategies are receiving events
- No unresolved drift alerts or strategy errors

---

## Stage 5: Portal Orientation

### First portal session

When the user opens the portal for the first time, they land on the dashboard. The dashboard shows the current deployment status.

Implementation note: the portal default route is `/dashboard`. Signal Recovery remains at `/signal` as the primary curated analytics entry for recovery metrics (see behavioural spec Part IX).

For a new deployment with no events yet, the dashboard shows a helpful empty state — not a blank screen. It tells the user what to do next: add the DNS CNAME, add the script tag, and wait for events.

For a deployment where events are already flowing (e.g., the user returns a day after setup), the dashboard shows live data immediately.

### What the user learns in Stage 5

The user explores the portal and develops a mental model of the system. The portal's information architecture leads with tracking value — the presenting problem — before compliance and evidence:

**Tracking and signal recovery:**
- Signal Recovery → the headline ROI: events recovered from ad blockers and ITP, cookie attribution extension, bot requests filtered
- Destinations → is every ad network receiving events correctly
- Request Logs → debug when something is wrong
- Cookies → first-party cookie status and attribution window

**Analytics:**
- Analytics Dashboard → curated views: consent rate, signal recovery, funnel, destination health
- Explore → free-form query against the customer's own ClickHouse or Tinybird data

**Compliance and evidence:**
- Consent Events → the individual consent records
- Evidence Chain → what was recorded and what it proves

**Configuration:**
- Strategies → what is running and where events are going
- Banner Config → what visitors see and what can be changed
- Policy Versions → what documents users are consenting to
- Site Config → operational settings including shadow/enforce

The user does not need to complete any mandatory onboarding flow. The portal is self-explanatory for its primary use cases.

### Stage 5 exit criteria

The user has a working understanding of what each section of the portal does.

---

## Stage 5a: Analytics Orientation (User C Entry Point)

### When this stage begins

Stage 5a begins when a data analyst (User C) first accesses the portal after a deployment is running with data flowing. This may happen days or weeks after the deployment was set up by User A or B. User C is given portal access via Cloudflare Access and arrives at a functioning system with existing event data.

User C does not need to understand how the deployment was configured. They need to understand how to query their data.

### What User C finds

The portal's Analytics section is the primary surface for User C. It has two sub-surfaces:

**Analytics Dashboard — curated views**
Pre-built charts answering the questions marketing and analytics teams ask every day. User C can read these immediately without any configuration:
- Signal recovery over time — how many events would have been lost to ad blockers and ITP vs. how many were delivered
- Consent rate by jurisdiction — actual enforcement rates broken down by detected geography
- Events by destination — volume and success rate per ad network
- Funnel analysis — page views → intent signals → consent decisions → post-consent conversions
- Attribution window distribution — what percentage of conversions attributed at 1 day / 7 days / 30 days+

**Explore — free-form query**
A SQL editor connected to the customer's ClickHouse or Tinybird instance via a read-only query proxy. User C writes SQL against the Attestrack event schema, sees results in a table, and optionally visualises them as a chart.

The Explore surface does not require User C to know how to configure a data connection. The portal already has the ClickHouse connection because it was configured at deploy time. User C inherits that connection with read-only access.

### What User C does in Stage 5a

User C opens the Analytics Dashboard and reads the curated views. They identify a question the pre-built views do not answer — for example, "what is the conversion rate for visitors who consented on first impression vs. those who needed a second presentation?" — and opens Explore to answer it.

In Explore, User C:
1. Writes SQL against the `tracking_events` table
2. Sees a result table immediately
3. Clicks "Visualise" to choose a chart type and render the result
4. Optionally saves the query as a named view that appears in their Analytics Dashboard

Saved queries become part of User C's personal dashboard. They are stored in CF KV alongside the deployment configuration.

### What User C does not need to do

User C does not need to:
- Configure a data connection (already done)
- Know the ClickHouse credentials (proxied by the portal)
- Install any separate BI tool
- Export data to a third-party analytics platform
- Learn any tool-specific query language beyond standard SQL

### Stage 5a exit criteria

User C has:
- Opened the Analytics Dashboard and reviewed at least one curated view
- Written at least one SQL query in Explore and seen results
- Understood that the data is their own ClickHouse data, not a copy on any external server

---

## Stage 6: Configuration

### What the user configures before enforcement

Before activating enforcement, the user should review and confirm three things via the portal:

**6a. Banner configuration**
The user opens Banner Config and reviews the active banner configuration. If the default configuration is appropriate for their site, no changes are needed. If they want to adjust the gate trigger (e.g., fire at checkout rather than at 60% scroll), the mechanism type, or the disclosure documents, they make those changes here.

The user previews the banner before publishing changes. The preview shows them exactly what a visitor will see.

**6b. Policy versions**
The user opens Policy Versions and confirms that their privacy policy and terms of use are published. A new deployment has no policy versions loaded — the user must publish at least one of each before enforcement makes sense.

Publishing a policy version means pasting the text of the document into the portal and assigning a version label. The portal computes the hash and records the version. From this point, every consent event will reference the hash of the policy version that was active when the event occurred.

**6c. Jurisdiction review**
The user opens Site Configuration and reviews the jurisdiction rules. The default configuration applies the Standard profile to all visitors. If the user has California traffic and wants to apply the Elevated profile to California visitors, they make that change here.

The user is not expected to understand CIPA case law to use the community portal. The jurisdiction defaults are reasonable for most deployments. For users who want legal review of their configuration, the upgrade path to the Attestrue proof layer connects them with counsel.

### Stage 6 exit criteria

- At least one privacy policy version is published
- At least one terms of use version is published
- Banner configuration has been reviewed and accepted or adjusted
- Jurisdiction configuration has been reviewed

---

## Stage 7: Enforcement Activation

### The moment of enforcement

Enforcement activation is a deliberate, confirmed action. The user navigates to Site Configuration, finds the shadow mode / enforcement toggle, and switches it to enforcement. The portal requires them to type "ENABLE ENFORCEMENT" to confirm.

This is not friction for its own sake. Enforcement activation is the moment where visitor behaviour on the site changes — visitors who decline consent will not have their data sent to ad networks. This is a meaningful change that deserves ceremony.

### What changes when enforcement activates

From the visitor's perspective: they see the consent gate before tracking scripts fire. If they decline, no tracking scripts fire.

From the operator's perspective: the consent rate in the portal now represents actual signal being sent to ad networks. A 73% consent rate means 73% of visitors' data is reaching Meta, Google, and other configured networks.

### What the operator sees immediately after enforcement

The dashboard updates to show the green "ENFORCEMENT ACTIVE" indicator. The consent rate chart begins showing actual enforced rates. The evidence chain begins recording events with the enforcement flag set.

If consent rates are significantly lower than expected, the user can return to shadow mode by reversing the toggle (with the same confirmation flow). The portal explains this option clearly.

### Stage 7 exit criteria

- Enforcement is active
- The user understands that consent rates now reflect actual signal
- The user knows how to return to shadow mode if needed

---

## Stage 8: Ongoing Operation

### What the user does week-to-week

For most weeks, the user opens the portal, looks at the dashboard, and closes it. The primary use is monitoring: consent rate is holding, events are flowing, no drift alerts.

The portal surfaces the things that require attention without requiring the user to actively hunt for them. If a new script is detected, the drift alert appears on the dashboard. If a strategy fails, the strategy status card shows degraded. If consent rate drops unusually, the chart makes it visible.

### What the user does when something changes

**Updating a policy version:** When the privacy policy is updated, the user opens Policy Versions, pastes the new text, and publishes. The old version remains in history. All future consent events reference the new version's hash.

**Adding a new strategy:** When the marketing team starts running Pinterest ads, the user opens Strategies, enables the Pinterest adapter (if available in community strategies), and adds the credentials. The new strategy starts receiving events immediately.

**Receiving a drift alert:** When an unknown script is detected, the user sees the alert on the dashboard. They investigate, determine whether the script is legitimate or a rogue installation, and either add it to the trusted domains list or remove it from their site.

**Migrating from another CMP:** The user opens Migration, selects their current CMP, and follows the wizard. The wizard runs Attestrack in shadow mode alongside the old system for the validation period, then provides a cutover checklist.

### Stage 8 exit criteria

There is no exit from Stage 8 during normal operation. The user continues operating indefinitely.

---

## Stage 8a: Analytics and Data Exploration (Ongoing)

### When this stage is active

Stage 8a runs in parallel with Stage 8 from the point that enforcement is active and data is accumulating in ClickHouse. It has no defined start or end — it is the ongoing analytical use of the portal.

### User C's weekly workflow

For most weeks, User C opens the portal Analytics Dashboard, reviews the signal recovery and consent rate trends, checks whether any destination success rates have degraded, and closes it. This is a five-minute review.

When a specific business question arises — a campaign performance question, an attribution discrepancy, a request from the marketing team for funnel data — User C opens Explore, writes a query, and gets an answer from their own data without leaving the portal or sending data to a third party.

### The queries User C writes

The Explore surface gives User C access to the complete Attestrack event schema in ClickHouse. Common queries include:

**Attribution analysis**
> "What channels drove consented purchases in the last 30 days, broken down by UTM source and medium?"
SQL against `tracking_events` filtered to `consent_state = 'GRANTED'` and `event_name = 'purchase'`, grouped by UTM fields.

**Consent funnel analysis**
> "What percentage of visitors who saw the consent gate actually granted consent, by jurisdiction and gate trigger type?"
SQL against the consent event fields in `tracking_events`, grouped by jurisdiction and gate trigger.

**Signal recovery validation**
> "How many purchase events did we send to Meta CAPI that would have been blocked by ad blockers under browser-side tracking?"
SQL joining event data with user agent fields to estimate ad-blocker-affected sessions.

**Cookie attribution extension**
> "What percentage of our converting users converted more than 7 days after their first visit?"
SQL calculating the gap between first `page_view` event and `purchase` event per user identifier, filtered to gaps > 7 days.

**Bot traffic analysis**
> "Which IP ranges or user agent patterns are generating the most bot-scored requests?"
SQL against the bot scoring fields in `tracking_events`.

None of these queries require any tool beyond the portal's SQL editor. The data is already in the customer's ClickHouse. The portal provides the interface.

### Saving and sharing queries

User C can save any query as a named view. Saved queries:
- Appear as tiles in the user's personal Analytics Dashboard
- Can be shared with other portal users via a link (read-only, requires CF Access)
- Can be exported as a CSV from the results table
- Are stored in CF KV — no data leaves the customer's account

User C cannot share queries with Attestrack or Attestrue. The portal does not transmit query content or results to any external service.

### What User C never needs

User C never needs to:
- Export data to Google Analytics, Amplitude, Mixpanel, or any third-party analytics platform
- Configure a separate BI tool like Grafana, Metabase, or Looker
- Write code to build a dashboard
- Wait for data to sync to an external system
- Pay for a separate analytics subscription

The portal is the BI tool. The customer's ClickHouse is the data warehouse. The combination eliminates the reason to use any third-party analytics product for the questions Attestrack data can answer.

### Stage 8a exit criteria

There is no exit. This stage is ongoing for the life of the deployment.

---

## Stage 9: Upgrade Consideration

### The trigger

Stage 9 is not part of normal operation. It is triggered by one of three events:

**Trigger A — Demand letter received.** The user or their attorney receives a CIPA (or related privacy) demand letter. The user opens the portal and sees the Evidence Chain upgrade prompt. They understand for the first time why unsigned community records are insufficient for a legal proceeding and why **regulation-aware** configuration ( **Privacy Consent** add-on) and **independent witnessing** ( **Proof** add-on) are distinct purchases.

**Trigger B — Attorney engagement.** The user's attorney asks whether they have **independently witnessed** consent records and an adequate **regulatory** configuration story. The user does not, and counsel recommends the appropriate **Attestrue add-ons** (typically **Privacy Consent** + **Proof**, often as the **$449/mo** bundle).

**Trigger C — Proactive risk management.** The user reads about CIPA litigation, understands the risk, and wants to get ahead of it before receiving a demand letter.

### What the user does in Stage 9

The user navigates to the Upgrade page in the portal. They see a clear explanation of what **Proof** adds ( **`record_id`**, ledger witness, **daily dual-Git anchor**), that **Privacy Consent** delivers the **regulation database** and counsel-ready configuration above the community floor, and current **bundle** pricing (**Privacy + Proof $449/mo** per v9.2 §3.6). Copy must **not** imply that **Proof** includes **Operating Agreement** or **Acknowledgment** UX — those are **separate $99/mo** add-ons that **require Proof**.

The upgrade CTA links to `attestrue.com/upgrade?site_id={their_site_id}`. When they follow this link, the Attestrue signup flow knows which deployment they are upgrading. They do not re-enter their site details.

Licensed add-ons activate on the existing deployment with **no redeployment** (license key + Worker restart). Existing unsigned records remain unchanged; new **Proof**-eligible events receive independent witnessing from activation onward.

### Stage 9 exit criteria

The user has either:
- Activated the desired **Attestrue** add-ons (e.g. **Privacy + Proof**), or
- Decided not to upgrade at this time

In either case they return to Stage 8.

---

## Journey Summary

| Stage | Primary actor | Key outcome |
|---|---|---|
| 1 — Discovery | User A / B | Decision to deploy |
| 2 — Pre-deployment | User A / B | Credentials and decisions gathered |
| 3 — Deployment | CLI | Worker + portal running, shadow mode |
| 4 — Shadow mode validation | User A / B + portal | Baseline established, events confirmed |
| 5 — Portal orientation | User A / B | Mental model of the system |
| 5a — Analytics orientation | User C | First query written against own data |
| 6 — Configuration | User A / B via portal | Policy versions published, banner reviewed |
| 7 — Enforcement | User A / B via portal | Enforcement active, consent gated |
| 8 — Ongoing operation | User A / B via portal | Monitoring, maintenance, changes |
| 8a — Analytics and explore | User C via portal | Ongoing data exploration, no external tool needed |
| 9 — Upgrade (optional) | User + Attestrue | Proof layer activated |

---

## Appendix A: Analytics Implementation Strategy

*This appendix documents the recommended technical approach for the analytics layer. It is included here as a strategy reference — the specific stack recommendation — not as a binding implementation spec. The implementation spec is in the repo spec and portal community spec. This appendix documents the path forward agreed at the product strategy level.*

### The core architectural decision

The analytics layer is built on a **query proxy pattern**, not an embedded BI component. The portal's Worker API accepts structured queries from the frontend, proxies them to the customer's ClickHouse or Tinybird instance, and returns results. The chart rendering layer is a thin frontend concern.

This pattern is chosen over embedded BI platforms (Graphic Walker, Metabase, etc.) for two reasons:

First, licensing. The embeddable BI components that support server-side query pushdown to ClickHouse are commercially licensed for that capability. Graphic Walker's core React component is MIT licensed, but its ClickHouse query pushdown is an enterprise feature requiring Kanaries Cloud. Studying their open source code to understand the computation interface pattern is appropriate; using their commercial pushdown implementation is not.

Second, architecture fit. The portal already has a Worker API, already has the ClickHouse credentials, and already knows the event schema. A query proxy endpoint added to the existing Worker API achieves the same capability with no external dependency and no licensing concern.

### The recommended frontend stack

**Curated dashboard charts:** Recharts (MIT, 25K GitHub stars). Declarative React components, well-documented, widely used in production dashboards. Handles the time-series and categorical charts needed for signal recovery, consent rates, and destination health views.

**Explore chart rendering:** Apache ECharts via echarts-for-react (Apache 2.0 / MIT). Richer chart type library than Recharts — handles scatter, heatmap, sankey, and other chart types useful for attribution and funnel analysis. Canvas-based rendering handles larger result sets better than SVG.

**SQL editor in Explore:** CodeMirror 6 (MIT). The standard embeddable code editor with SQL language support, syntax highlighting, and autocomplete. Used in VS Code, Replit, and most web-based SQL editors. Adds ClickHouse SQL dialect support via the community extension.

**Results table:** TanStack Table (MIT, formerly react-table). Headless table component — provides sorting, filtering, pagination, and column resizing without imposing any styling. Renders with the Attestrue design system.

**Chart type selector UI:** Built-in to the portal using the Attestrue design system components. Not a third-party component — a simple picker showing chart type icons that sets the ECharts chart configuration.

### The query proxy endpoint

The Worker API gains one new endpoint:

```
POST /api/portal/analytics/query
Authorization: CF Access token (existing)
Body: {
  sql: string,        // read-only SQL — validated before execution
  limit: number,      // max 10,000 rows — enforced server-side
  format: 'json'      // result format
}
Response: {
  columns: ColumnDefinition[],
  rows: Record<string, unknown>[],
  execution_time_ms: number,
  row_count: number
}
```

The Worker validates the query before execution:
- Must be a `SELECT` statement — no `INSERT`, `UPDATE`, `DELETE`, `DROP`, `CREATE`, `ALTER`
- Must reference only tables in the Attestrack schema allowlist — prevents access to other tables in the customer's ClickHouse
- Enforces the row limit regardless of the SQL — `LIMIT` is appended to the query if absent or if the specified limit exceeds the maximum
- Times out at 30 seconds

The validation is a simple AST check against the query string, not a full SQL parser. False positives (a valid query rejected) are acceptable. False negatives (an invalid query executed) are not. When in doubt, reject.

### The schema autocomplete

The Explore SQL editor provides autocomplete for the Attestrack event schema. The schema definition is already in the portal's data layer (it's how the curated dashboard queries are written). The CodeMirror ClickHouse dialect extension accepts a schema definition object and provides field-level autocomplete.

The user types `SELECT ` and sees the available fields from `tracking_events`. They type `FROM ` and see the available tables. They never need to look up the schema separately.

### The saved query model

Saved queries are stored in CF KV under the key `portal:saved_queries:{user_id}:{query_id}`. Each entry contains:
- Query name
- SQL string
- Last run timestamp
- Pinned chart configuration (if the user saved a visualisation)
- Whether it is pinned to the analytics dashboard

The CF KV storage means saved queries live in the customer's own infrastructure. They are not stored in Attestrack or Attestrue systems. A customer who stops using Attestrack retains their saved queries in their CF KV.

### Why not Grafana

Grafana is the obvious comparison. The reason not to embed or bundle Grafana is deployment complexity — Grafana requires a separate server deployment with its own database, authentication, and configuration. The portal is a CF Pages static SPA with no server of its own. Grafana cannot be embedded in a CF Pages deployment in any reasonable way.

The query proxy pattern gives users 80% of Grafana's value for tracking analytics without the deployment complexity. Users who need the full Grafana feature set — alerting, provisioned dashboards, team sharing, plugin ecosystem — can connect Grafana to their ClickHouse directly using the official ClickHouse Grafana plugin. The portal does not compete with that use case and does not need to.

### Why not a third-party embedded analytics product

Products like Embeddable, Luzmo, or Explo provide embedded analytics for SaaS products. They are designed for the case where you want to show your customers analytics about their use of your product. That is not the Attestrack use case. Attestrack users are analysing their own data about their own visitors. They need direct query access to their own warehouse, not a managed analytics layer sitting in front of it.

Using a third-party embedded analytics product would also contradict the core Attestrack value proposition — that customer data never leaves their infrastructure. Any third-party analytics platform that processes queries would receive customer tracking data. This is precisely the architecture Attestrack is designed to avoid.

---

*Version 1.2 — March 2026 (Architecture Change Spec v9.2)*
*Supersedes version 1.0 and 1.1*
*Companion documents: Portal Community Spec v1.0 · Portal Community Tracking Features Spec v1.0 · Attestrack Behavioural Spec v1.2 · Repo Spec v2.1 · Architecture Change Spec v9.2*