import { test, expect } from '@playwright/test'

test.describe('Stage4-shadow — worker smoke', () => {
  test('health endpoint', async ({ request }) => {
    const res = await request.get('/health')
    expect(res.ok()).toBeTruthy()
    expect(await res.text()).toContain('ok')
  })

  test('tracking ingest accepts event', async ({ request }) => {
    const res = await request.post('/t/event', {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({
        v: 1,
        eventName: 'e2e',
        siteId: 'e2e',
        occurredAt: new Date().toISOString()
      })
    })
    expect(res.ok()).toBeTruthy()
    const json = (await res.json()) as { accepted?: boolean }
    expect(json.accepted).toBe(true)
  })
})
