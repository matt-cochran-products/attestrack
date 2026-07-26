/**
 * P6.5 — browser-level a11y for the consent banner: axe-core scan plus a
 * keyboard-only run (Tab/Space/Enter/Escape). Component-level axe coverage
 * lives in packages/consent-js/__tests__/banner-a11y.test.ts (vitest-axe).
 *
 * The banner is intentionally NON-modal (role=region): there is no focus trap,
 * and Tab must be able to leave the banner — asserted below.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const PAGE_ORIGIN = 'http://localhost:8788'
const BANNER = '[data-attestrack-banner="community"]'

async function openBanner(page: Page) {
  await page.setExtraHTTPHeaders({ 'cf-ipcountry': 'DE' })
  await page.goto(`${PAGE_ORIGIN}/banner.html`)
  await expect(page.locator(`${BANNER} input[type="checkbox"]`).first()).toBeVisible()
}

test('banner region has no serious/critical axe violations', async ({ page }) => {
  await openBanner(page)
  const results = await new AxeBuilder({ page }).include(BANNER).analyze()
  const severe = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))
  expect(severe.map((v) => `${v.id}: ${v.description}`)).toEqual([])
})

test('keyboard-only: Tab reaches every control, Space checks IOA, Enter activates Accept', async ({
  page,
  context,
}) => {
  await openBanner(page)

  // Initial focus lands on the first actionable control: the required IOA
  // checkbox (Accept is disabled until it is checked, so it cannot hold focus).
  await expect(page.locator(`${BANNER} input[type="checkbox"]`).first()).toBeFocused()
  await page.keyboard.press('Space')
  await expect(page.locator(`${BANNER} input[type="checkbox"]`).first()).toBeChecked()

  // Tab forward to Accept and activate with Enter — no mouse involved.
  for (let i = 0; i < 8; i++) {
    const name = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.textContent ?? '',
    )
    if (name === 'Accept') break
    await page.keyboard.press('Tab')
  }
  await page.keyboard.press('Enter')
  await expect(page.locator(BANNER)).toHaveCount(0)
  const cookie = (await context.cookies('http://localhost:8791')).find(
    (c) => c.name === 'at_consent',
  )
  expect(cookie).toBeTruthy()
})

test('keyboard-only: Escape dismisses without recording a decision (no cookie)', async ({
  page,
  context,
}) => {
  await openBanner(page)
  await page.keyboard.press('Escape')
  await expect(page.locator(BANNER)).toHaveCount(0)
  const cookie = (await context.cookies('http://localhost:8791')).find(
    (c) => c.name === 'at_consent',
  )
  expect(cookie).toBeUndefined()
})

test('no focus trap: Tab can leave the non-modal banner into page content', async ({ page }) => {
  await openBanner(page)
  // From the last banner control, Tab moves focus out of the banner.
  let leftBanner = false
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab')
    const inBanner = await page.evaluate(() => {
      const el = document.activeElement
      return !!el?.closest('[data-attestrack-banner="community"]')
    })
    if (!inBanner) {
      leftBanner = true
      break
    }
  }
  expect(leftBanner).toBe(true)
})
