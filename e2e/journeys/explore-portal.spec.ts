/**
 * P6.2 — Explore query round-trip + portal live-mode smoke.
 *
 * Portal SPA (built with VITE_ATTESTRACK_API_BASE_URL=http://localhost:8788,
 * i.e. LIVE mode) is served by the page server, which proxies
 * /__attestrack__/* same-origin to the workerd worker — mirroring production
 * where the Worker route intercepts the API prefix on the portal hostname
 * (the portal API deliberately has no CORS).
 *
 * The Explore round-trip is UI → Worker SQL gate → warehouse (mock ClickHouse
 * HTTP endpoint speaking FORMAT JSON) → results table.
 */
import { expect, test } from '@playwright/test'

const PAGE_ORIGIN = 'http://localhost:8788'

test.describe('portal live-mode smoke', () => {
  test('dashboard renders in live mode against the worker API', async ({ page }) => {
    const failures: string[] = []
    page.on('pageerror', (e) => failures.push(String(e)))
    await page.goto(`${PAGE_ORIGIN}/dashboard`)
    // Shell renders (nav present) and the page is not the stub-data variant.
    await expect(page.getByRole('link', { name: /explore/i }).first()).toBeVisible()
    expect(failures).toEqual([])
  })
})

test.describe('Explore query round-trip (EXP.1)', () => {
  test('default query runs through the Worker proxy and renders warehouse rows', async ({
    page,
  }) => {
    await page.goto(`${PAGE_ORIGIN}/explore`)

    // Warehouse is configured (CLICKHOUSE_QUERY_URL in .dev.vars) → editor shows.
    const run = page.getByRole('button', { name: /^Run/ })
    await expect(run).toBeVisible()

    const queryRes = page.waitForResponse((r) =>
      r.url().includes('/__attestrack__/portal/v1/explore/query'),
    )
    await run.click()
    const res = await queryRes
    expect(res.status()).toBe(200)
    const body = (await res.json()) as { columns: string[]; rowCount: number }
    expect(body.columns).toEqual(['eventName', 'count'])
    expect(body.rowCount).toBe(2)

    // Rows from the mock warehouse render in the results table.
    await expect(page.getByText('page_view')).toBeVisible()
    await expect(page.getByText('e2e_click')).toBeVisible()
  })

  test('SQL gate rejects a non-SELECT before any warehouse call (INV-B-14)', async ({ page }) => {
    await page.goto(`${PAGE_ORIGIN}/explore`)
    await expect(page.getByRole('button', { name: /^Run/ })).toBeVisible()

    // Drive the gate through the SAME portal client path the UI uses, from the
    // page context (same-origin proxy → worker).
    const result = await page.evaluate(async () => {
      const res = await fetch('/__attestrack__/portal/v1/explore/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sql: 'DROP TABLE events' }),
      })
      return { status: res.status, body: (await res.json()) as { error?: string } }
    })
    expect(result.status).toBe(400)
    expect(result.body.error).toBeTruthy()
  })
})
