import { describe, expect, it, vi } from 'vitest'
import { createAttestrackFetchHandler } from '../../src/create-fetch-handler.js'
import {
  createPrivacyConsentToken,
  createMockHostRuntime,
  flushMockBackgroundTasks,
  noopStrategyLoader
} from '@attestrack/sdk'
import { defaultCommunityStrategies } from '@attestrack/strategies'
import { KV_KEY_CONSENT_EVENT_PREFIX } from '@attestrack/types'

const SECRET = 'mitigation-secret-32-chars-min!!'

function makeHandler(host: ReturnType<typeof createMockHostRuntime>) {
  return createAttestrackFetchHandler({
    host,
    consentSecretName: 'CONSENT_TOKEN_SECRET',
    bundledStrategies: defaultCommunityStrategies('CONSENT_TOKEN_SECRET'),
    strategyLoader: noopStrategyLoader
  })
}

function trackingBody() {
  return JSON.stringify({
    v: 1,
    eventName: 'pv',
    siteId: 'local',
    occurredAt: new Date().toISOString()
  })
}

describe('P7.1: consent-event KV write amplification (contract)', () => {
  it('anonymous /t/event flood writes ZERO consent-event records', async () => {
    const host = createMockHostRuntime({ secrets: { CONSENT_TOKEN_SECRET: SECRET } })
    const put = vi.spyOn(host.kv, 'put')
    const handler = makeHandler(host)
    for (let i = 0; i < 25; i += 1) {
      const res = await handler(
        new Request('https://t.example.com/t/event', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: trackingBody()
        })
      )
      expect(res.status).toBe(200)
    }
    await flushMockBackgroundTasks(host)
    const consentEventWrites = put.mock.calls.filter(([key]) =>
      (key as string).startsWith(KV_KEY_CONSENT_EVENT_PREFIX)
    )
    expect(consentEventWrites).toHaveLength(0)
  })

  it('anonymous unmatched-route flood writes ZERO consent-event records', async () => {
    const host = createMockHostRuntime({ secrets: { CONSENT_TOKEN_SECRET: SECRET } })
    const put = vi.spyOn(host.kv, 'put')
    const handler = makeHandler(host)
    for (const path of ['/wp-login.php', '/favicon.ico', '/', '/admin']) {
      await handler(new Request(`https://t.example.com${path}`))
    }
    const consentEventWrites = put.mock.calls.filter(([key]) =>
      (key as string).startsWith(KV_KEY_CONSENT_EVENT_PREFIX)
    )
    expect(consentEventWrites).toHaveLength(0)
  })

  it('a consented visitor writes exactly ONE record across repeated requests', async () => {
    const host = createMockHostRuntime({ secrets: { CONSENT_TOKEN_SECRET: SECRET } })
    const put = vi.spyOn(host.kv, 'put')
    // siteId must match site config default ('local') — tokens are site-bound (P2.2).
    const token = await createPrivacyConsentToken(SECRET, {
      siteId: 'local',
      decision: 'granted',
      policyHash: 'h'
    })
    const handler = makeHandler(host)
    for (let i = 0; i < 10; i += 1) {
      const res = await handler(
        new Request('https://t.example.com/t/event', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: `at_consent=${encodeURIComponent(token)}`
          },
          body: trackingBody()
        })
      )
      expect(res.status).toBe(200)
      await flushMockBackgroundTasks(host)
    }
    const consentEventWrites = put.mock.calls.filter(([key]) =>
      (key as string).startsWith(KV_KEY_CONSENT_EVENT_PREFIX)
    )
    expect(consentEventWrites).toHaveLength(1)
  })
})
