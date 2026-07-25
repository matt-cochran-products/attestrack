# Demo script — 5-minute "deploy → consent → event → Explore"

> **Status: maintainer-to-execute.** This is the storyboard and exact command list for
> the launch screencast/gif (plan P8.5 — the go-public proof artifact). It requires live
> Cloudflare credentials, a real domain, and a reachable ClickHouse or Tinybird — none of
> which exist in CI, so nothing here has been recorded yet. Commands and expected outputs
> below were verified against the current CLI/Worker source; re-verify while recording.
> When recorded, embed the gif + link in the README's **Demo** section.

**Recording setup:** clean terminal, 16:9, dark theme, font ≥ 16 pt. One take per act is
fine — cut dead time between acts. Target ≤ 5 minutes total.

**Prerequisites (off camera):**

- Cloudflare account, `npx wrangler login` done; a zone you control (`<DEMO_DOMAIN>`, e.g.
  `demo.example.com` with the Worker on `t.<DEMO_DOMAIN>`)
- ClickHouse reachable over HTTPS with the repo DDL applied
  (`clickhouse-client < packages/schema/warehouse/clickhouse.sql`) — or Tinybird
- Pre-launch: run from a repo clone (dev mode). Post-publish: any empty directory
  (`npx @attestrack/deploy`)
- A throwaway page on `<DEMO_DOMAIN>` that embeds
  `<script src="https://t.<DEMO_DOMAIN>/consent.js" defer></script>`

---

## Act 1 — Deploy (0:00–1:45)

Say: *"Attestrack runs entirely in your Cloudflare account — one command deploys the
Worker, KV, and the operator portal."*

```bash
npx @attestrack/deploy        # dev mode: pnpm --filter @attestrack/deploy exec attestrack-deploy
```

On camera you'll see the numbered steps (`step k/N`): wrangler auth check → KV namespace
create → scaffold files written to `attestrack-deploy/` → `npm install` → KV seed
(`attestrack:enabled_strategies` defaults to `["clickhouse","tinybird","drift-detection"]`)
→ masked prompt for `CONSENT_TOKEN_SECRET` → `wrangler deploy` → portal build + Pages
deploy → health poll. Ends with the completion banner (Worker URL, portal URL, Access
reminder).

Then set the warehouse secrets and add them to the Worker (off camera is fine, mention it):

```bash
cd attestrack-deploy
npx wrangler secret put CLICKHOUSE_HTTP_URL
npx wrangler secret put CLICKHOUSE_QUERY_URL
npx wrangler secret put CLICKHOUSE_USER
npx wrangler secret put CLICKHOUSE_PASSWORD
```

Verification beat (on camera):

```bash
npx @attestrack/deploy verify
```

Expected: health `200 ok`, custom-domain check (may report *pending* — say "DNS can take a
day, the CLI is honest about it"), portal Access check, consent-commit check.

## Act 2 — Consent (1:45–2:45)

Say: *"Consent is first-party: the banner script is served by your Worker, and the token
is minted and verified there — HMAC-signed, in your KV, on your domain."*

Open the demo page → the consent banner renders from `/consent.js` → click **Accept**.
Show DevTools → Application → Cookies: the `at_consent` cookie on `.<DEMO_DOMAIN>`.

Terminal beat (same thing, scriptable):

```bash
curl -s -X POST "https://t.<DEMO_DOMAIN>/__attestrack__/consent/commit" \
  -H 'content-type: application/json' \
  -d '{"siteId":"<SITE_ID>","decision":"granted","policyHash":"demo-policy-v1"}'
```

Expected: `{"token":"k1.eyJ…"}` (plus a `Set-Cookie: at_consent=…` header — show it with
`-i` if you want the beat).

## Act 3 — Event (2:45–3:30)

Say: *"Events hit your subdomain and fan out server-side — no third-party pixels in the
page."*

```bash
curl -s -X POST "https://t.<DEMO_DOMAIN>/t/event" \
  -H 'content-type: application/json' \
  -d '{"v":1,"eventName":"demo_cta_click","siteId":"<SITE_ID>","occurredAt":"'"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"'","pagePath":"/pricing","ctaType":"signup"}'
```

Expected: `{"ok":true,"accepted":true}` — instantly; the pipeline (consent gate →
destinations → warehouse) runs in the background. Fire it 5–10 times (loop or up-arrow)
so the next act has data.

## Act 4 — Portal + Explore (3:30–4:45)

Open the portal (behind Cloudflare Access — let the login flash by, say *"the portal sits
behind your Cloudflare Access"*).

- **Dashboard:** `eventsToday` is non-zero — computed from real traffic, no seeded numbers.
- **Request Logs:** the demo events with consent status `GRANTED` / `PROCESSED`.
- **Explore:** run

```sql
SELECT eventName, count() AS events
FROM events
GROUP BY eventName
ORDER BY events DESC
```

Results table appears (read-only SQL gate, 500-row clamp); flip the visualization to a
bar chart. Say: *"This is your ClickHouse — Attestrack never sees a byte of it."*

## Act 5 — Close (4:45–5:00)

Say: *"MIT-licensed analytics, server-side measurement, and community consent — in your
account. Attorney-maintained regulation packs and witnessed consent evidence are the paid
extensions. github.com/matt-cochran/attestrack."*

---

## After recording (maintainer)

1. Export a ≤ 15 MB gif (or short mp4) of Acts 2–4 highlights + the full video link.
2. Replace the placeholder in README **Demo** section with the gif and link.
3. Keep the demo property deployed — it doubles as the "quickstart re-executed on a clean
   machine" evidence for [GO-PUBLIC-CHECKLIST.md](GO-PUBLIC-CHECKLIST.md).
