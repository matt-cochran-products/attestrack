# Portal runtime configuration & acceptance evidence

## Data source resolution

The portal decides where its data comes from at page load
([`src/lib/api/runtime-config.ts`](../src/lib/api/runtime-config.ts)). The first
present source wins; an invalid source is **never** replaced by a later one.

| # | Source | Accepted values | Result |
|---|---|---|---|
| 1 | `<meta name="attestrack-portal-api" content="…">` in the served `index.html` | `same-origin` | Live: portal API calls go to `window.location.origin` + `/__attestrack__/portal/v1/*` |
| | | `stub` | Explicit demo: sample data, shell chip **Demo — sample data** |
| | | anything else (URLs, paths, `//host`, empty, duplicates) | **Configuration error** (fail closed) |
| 2 | `VITE_ATTESTRACK_API_BASE_URL` (build time, legacy / deploy CLI / e2e) | `https://host[:port]` (or `http://localhost…` / loopback) with no userinfo, path, query or hash | Live against that origin |
| | | anything else | **Configuration error** |
| 3 | nothing | Vite dev server / vitest | Local stub data (chip **Local stub data**) |
| | | production build | **Configuration error** |

On **Configuration error** the shell shows a red chip and a plain alert banner
("Data is unavailable: this portal has a configuration error"); every API call
throws `PortalConfigError` before any network I/O. The product UI deliberately
carries no setup instructions — the specific reason is on
`PortalConfigError.reason` (and `getPortalDataSource().reason`) for operators, and
the fix is this document. No page renders sample data. HTTP 401/403 and network
failures from a live Worker surface as errors too — they never fall back to stubs.

All requests use `credentials: 'include'` (the Cloudflare Access session cookie)
and `redirect: 'error'`: the client never follows a redirect. A 307/308 could
otherwise replay a credentialed POST body (Explore SQL) to another origin, and an
expired Access session's login redirect would be followed silently. Instead the
request rejects with a network error that the page shows; the recovery is to
**reauthenticate** (reload the portal so Access can run its login flow) — there is
no stub fallback.
The portal never carries service tokens, Access client secrets or other
credentials, and the runtime meta cannot name an arbitrary egress URL.

## Supplying runtime config without a rebuild

The compiled JS/CSS assets are identical across environments; only the host HTML
differs. To promote one artifact from staging to production:

1. Build the portal once (`pnpm --filter @attestrack/portal-community build`)
   **without** `VITE_ATTESTRACK_API_BASE_URL`.
2. In each environment's copy of `dist/index.html`, add inside `<head>`:

   ```html
   <meta name="attestrack-portal-api" content="same-origin" />
   ```

   Either edit the file in the per-environment copy before uploading it, or have
   your edge/host inject the element into the HTML response. Do not add the meta
   to the repository's `index.html` (the dev server would then call itself).
3. Record the SHA-256 of the served `index.html` — it is part of the acceptance
   identity (below).

If a legacy build already baked `VITE_ATTESTRACK_API_BASE_URL`, adding the meta
overrides it at runtime.

### Deployment prerequisites for `same-origin`

`same-origin` only works when the portal hostname also routes
`/__attestrack__/portal/v1/*` to the Attestrack Worker. Before switching:

- The Worker's portal API is reachable on the **portal's own hostname** under
  `/__attestrack__/portal/v1/*` (e.g. a Worker route on that hostname/zone); the
  static portal assets are served for every other path.
- The whole hostname (static assets **and** the portal API path) is behind the
  same Cloudflare Access application, so the browser's Access session cookie
  authenticates the API calls. Requests without a session must be denied or
  redirected to Access login.
- The Worker's direct hostname (e.g. `*.workers.dev`) does not expose the portal
  API without Access.
- The portal is served over `https:` (only loopback may use `http:`).

How these routes and Access policies are created is provider- and
account-specific; follow your Cloudflare configuration process. This repository
does not ship commands for it.

## Acceptance evidence contract

[`src/lib/acceptance/evidence.ts`](../src/lib/acceptance/evidence.ts) defines
`DashboardAcceptanceEvidence` (`schema: attestrack.dashboard-acceptance/v1`) and
`validateAcceptanceEvidence(unknown)`. A record is **metadata only** — digests and
relative refs to artifacts stored elsewhere; never raw tokens, cookies, response
bodies or customer data.

A record must contain:

- **Marker** — one unique fictional marker `ATK-FICTIONAL-<16–64 lowercase alnum>`.
- **Durable warehouse row** — `source: 'warehouse-readback'` from the `events`
  table: the row's `eventId` (the client idempotency key, not a warehouse-assigned
  id), its `receivedAt` (the canonical `events.receivedAt` column) and the
  read-back `observedAt`, the marker as read back, and a read-back artifact ref.
  `eventId`, `receivedAt` and the marker are copied from the actual row returned
  by the read-back query, not from the request that produced it. An ingest `accepted`/200, `/health`, or fixture is
  rejected.
- **Authenticated Explore response** — same-origin `POST
  /__attestrack__/portal/v1/explore/query`, `credentials: 'include'`, Access
  session, status 200 with `rowCount >= 1`, the marker in the response, response
  digest and HAR ref.
- **Screenshots** — including one `explore-result-with-marker`.
- **UI transport marker** — a separate `ATK-UI-…` marker plus the **Live worker**
  shell label and its screenshot, showing that the UI issued the request.
- **Negative outcomes** — consent declined (not delivered), unknown site
  (rejected 4xx), unauthenticated Access (401/403/302/303), direct origin
  (401/403/404), each with observed status, timestamp and ref.
- **Window** — every timestamp inside one window of at most 60 s.
- **Identity** — 40-hex source commit, portal + Worker artifact digests, the
  runtime-config mechanism (`html-meta`, `same-origin`) and the host HTML digest,
  environment, and the exact https portal origin (local/example origins rejected).

Unknown fields, bare booleans/`passed`/`accepted` flags, and credential- or
PII-looking strings are rejected. Input must be plain bounded JSON: cyclic
references, nesting deeper than 16 levels or more than 2,000 values are reported
as errors (the validator returns, it never throws). A passing record returns
`status: 'evidence-structurally-valid'` with `liveAcceptanceClaimed: false`: the
validator checks shape and consistency only. It does not observe a deployment and
is not live acceptance by itself.
