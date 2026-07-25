/**
 * P6.2 — cross-origin consent journeys against REAL workerd (`wrangler dev`).
 *
 * Page origin http://localhost:8788 ≠ worker origin http://localhost:8791:
 * same-site/cross-origin, the documented www./t. topology (P2.1). The banner
 * bundle is served BY the worker (/consent.js), commits go cross-origin with
 * credentials, and the worker sets the at_consent cookie via Set-Cookie.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const PAGE_ORIGIN = 'http://localhost:8788'
const WORKER_ORIGIN = 'http://localhost:8791'
const BANNER = '[data-attestrack-banner="community"]'

function decodeTokenPayload(token: string): { decision?: string; siteId?: string; ioa?: string[] } {
  const part = token.split('.')[1] ?? ''
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as {
    decision?: string
    siteId?: string
    ioa?: string[]
  }
}

async function consentCookie(context: BrowserContext) {
  // Read against the WORKER origin: proves the cross-origin Set-Cookie was
  // accepted by the browser and will be attached to /t/event requests.
  const cookies = await context.cookies(WORKER_ORIGIN)
  return cookies.find((c) => c.name === 'at_consent') ?? null
}

async function openBanner(page: Page) {
  await page.goto(`${PAGE_ORIGIN}/banner.html`)
  await expect(page.locator(BANNER)).toBeVisible()
  // Config-driven re-render (jurisdiction row fetch) settles: EU row shows a checkbox.
  await expect(page.locator(`${BANNER} input[type="checkbox"]`).first()).toBeVisible()
}

test.describe('consent banner — grant (cross-origin commit)', () => {
  test('required IOA gates Accept; grant sets a worker-origin cookie with the IOA ids', async ({
    page,
    context,
  }) => {
    await page.setExtraHTTPHeaders({ 'cf-ipcountry': 'DE' })
    await openBanner(page)

    const accept = page.getByRole('button', { name: 'Accept' })
    const reject = page.getByRole('button', { name: 'Reject all' })
    await expect(reject).toBeVisible()

    // INV-B-06: required IOA checkbox unchecked → Accept disabled.
    await expect(accept).toBeDisabled()
    await page.locator(`${BANNER} input[type="checkbox"]`).first().check()
    await expect(accept).toBeEnabled()

    const commit = page.waitForResponse((r) =>
      r.url().includes('/__attestrack__/consent/commit'),
    )
    await accept.click()
    expect((await commit).status()).toBe(200)
    await expect(page.locator(BANNER)).toHaveCount(0)

    const cookie = await consentCookie(context)
    expect(cookie).not.toBeNull()
    const payload = decodeTokenPayload(decodeURIComponent(cookie!.value))
    expect(payload.decision).toBe('granted')
    expect(payload.siteId).toBe('site_e2e')
    expect(payload.ioa).toContain('primary')
  })

  test('granted cookie reaches the worker on subsequent tracking ingest', async ({ page }) => {
    await page.setExtraHTTPHeaders({ 'cf-ipcountry': 'DE' })
    await openBanner(page)
    await page.locator(`${BANNER} input[type="checkbox"]`).first().check()
    await page.getByRole('button', { name: 'Accept' }).click()
    await expect(page.locator(BANNER)).toHaveCount(0)

    // Cross-origin credentialed POST from the page context; the worker's consent
    // gate re-verifies the cookie token HMAC server-side.
    const result = await page.evaluate(
      async ([workerOrigin]) => {
        const res = await fetch(`${workerOrigin}/t/event`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            v: 1,
            eventName: 'e2e_after_grant',
            siteId: 'site_e2e',
            occurredAt: new Date().toISOString(),
          }),
        })
        return { status: res.status, body: (await res.json()) as { accepted?: boolean } }
      },
      [WORKER_ORIGIN],
    )
    expect(result.status).toBe(200)
    expect(result.body.accepted).toBe(true)
  })
})

test.describe('consent banner — decline', () => {
  test('Reject all commits a declined decision (co-equal control, INV-B-07)', async ({
    page,
    context,
  }) => {
    await page.setExtraHTTPHeaders({ 'cf-ipcountry': 'DE' })
    await openBanner(page)

    const accept = page.getByRole('button', { name: 'Accept' })
    const reject = page.getByRole('button', { name: 'Reject all' })
    // INV-B-07: co-equal presentation — same computed background and font size.
    const styles = async (l: typeof accept) =>
      l.evaluate((el) => {
        const s = getComputedStyle(el)
        return { bg: s.backgroundColor, size: s.fontSize, weight: s.fontWeight }
      })
    expect(await styles(reject)).toEqual(await styles(accept))

    await reject.click()
    await expect(page.locator(BANNER)).toHaveCount(0)
    const cookie = await consentCookie(context)
    expect(cookie).not.toBeNull()
    expect(decodeTokenPayload(decodeURIComponent(cookie!.value)).decision).toBe('declined')
  })
})

test.describe('consent banner — GPC', () => {
  test('GPC signal auto-declines without rendering the banner (EU row honors GPC)', async ({
    browser,
  }) => {
    const context = await browser.newContext()
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'globalPrivacyControl', {
        get: () => true,
        configurable: true,
      })
    })
    const page = await context.newPage()
    await page.setExtraHTTPHeaders({ 'cf-ipcountry': 'DE' })

    const commit = page.waitForResponse((r) => r.url().includes('/__attestrack__/consent/commit'))
    await page.goto(`${PAGE_ORIGIN}/banner.html`)
    expect((await commit).status()).toBe(200)

    await expect(page.locator(BANNER)).toHaveCount(0)
    const cookie = (await context.cookies(WORKER_ORIGIN)).find((c) => c.name === 'at_consent')
    expect(cookie).not.toBeNull()
    expect(decodeTokenPayload(decodeURIComponent(cookie!.value)).decision).toBe('declined')
    await context.close()
  })
})
