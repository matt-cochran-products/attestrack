import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockHostRuntime, readDeliveryStats } from '@attestrack/sdk'
import type { Strategy } from '@attestrack/sdk'
import type { TrackingEventV1 } from '@attestrack/types'
import { createGoogleMpStrategy } from '../src/ad-networks/google.js'
import { createMetaCapiStrategy } from '../src/ad-networks/meta.js'
import { createMicrosoftUetStrategy } from '../src/ad-networks/microsoft.js'
import { createTikTokEventsStrategy } from '../src/ad-networks/tiktok.js'

/**
 * Mutation-hardening suite (Stryker) for the four ad-network destinations:
 * the consent/bot gating short-circuits, per-secret configuration guards,
 * the exact wire format (URL, method, headers, body fields) and delivery
 * recording — pinned per network so literal/operator mutants die.
 */

const tracking: TrackingEventV1 = {
  v: 1,
  eventName: 'purchase',
  siteId: 'site-1',
  occurredAt: '2026-07-25T10:00:00.000Z'
}

const grantedConsent = {
  raw: 'k1.p.s',
  payload: {
    v: 1 as const,
    siteId: 'site-1',
    decision: 'granted' as const,
    issuedAt: '2026-07-25T09:00:00.000Z',
    policyHash: 'h'
  }
}

interface NetworkSpec {
  name: string
  make: () => Strategy
  id: string
  displayName: string
  secrets: Record<string, string>
}

const NETWORKS: NetworkSpec[] = [
  {
    name: 'google-mp',
    make: createGoogleMpStrategy,
    id: 'google-mp',
    displayName: 'Google Measurement Protocol',
    secrets: { GOOGLE_MP_API_SECRET: 'gsec', GOOGLE_MEASUREMENT_ID: 'G-123' }
  },
  {
    name: 'meta-capi',
    make: createMetaCapiStrategy,
    id: 'meta-capi',
    displayName: 'Meta Conversions API',
    secrets: { META_ACCESS_TOKEN: 'mtok', META_PIXEL_ID: 'px9' }
  },
  {
    name: 'microsoft-uet',
    make: createMicrosoftUetStrategy,
    id: 'microsoft-uet',
    displayName: 'Microsoft UET offline conversions',
    secrets: { MICROSOFT_UET_ACCESS_TOKEN: 'mstok', MICROSOFT_UET_TAG_ID: 'tag7' }
  },
  {
    name: 'tiktok-events',
    make: createTikTokEventsStrategy,
    id: 'tiktok-events',
    displayName: 'TikTok Events API',
    secrets: { TIKTOK_ACCESS_TOKEN: 'ttok', TIKTOK_PIXEL_ID: 'pix3' }
  }
]

afterEach(() => vi.restoreAllMocks())

function ctxFor(host: ReturnType<typeof createMockHostRuntime>, overrides: Record<string, unknown> = {}) {
  return {
    host,
    request: new Request('https://x/', { headers: { 'user-agent': 'UA-under-test' } }),
    tracking,
    consent: grantedConsent,
    ...overrides
  } as never
}

for (const net of NETWORKS) {
  describe(`${net.name} destination gating + manifest`, () => {
    it('exposes the exact manifest (id / stage / displayName / defaultEnabled=false)', () => {
      const s = net.make()
      expect(s.id).toBe(net.id)
      expect(s.stage).toBe('destination')
      expect(s.manifest).toEqual({
        id: net.id,
        stage: 'destination',
        displayName: net.displayName,
        defaultEnabled: false
      })
    })

    it('does nothing without a tracking event (no fetch, no recorded outcome)', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      const host = createMockHostRuntime({ secrets: net.secrets })
      const res = await net.make().run(ctxFor(host, { tracking: undefined }))
      expect(res).toStrictEqual({ continuePipeline: true })
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(await readDeliveryStats(host.kv, net.id)).toBeNull()
    })

    it('never fires for bot-flagged traffic (P3.4), even with granted consent', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      const host = createMockHostRuntime({ secrets: net.secrets })
      const res = await net
        .make()
        .run(ctxFor(host, { botDetection: { isBot: true, reasons: ['bot_user_agent'] } }))
      expect(res).toStrictEqual({ continuePipeline: true })
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    for (const missing of Object.keys(net.secrets)) {
      it(`stays inactive when ${missing} alone is missing`, async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch')
        const secrets = { ...net.secrets }
        delete secrets[missing as keyof typeof secrets]
        const host = createMockHostRuntime({ secrets })
        const res = await net.make().run(ctxFor(host))
        expect(res).toStrictEqual({ continuePipeline: true })
        expect(fetchSpy).not.toHaveBeenCalled()
        expect(await readDeliveryStats(host.kv, net.id)).toBeNull()
      })
    }

    it('records HTTP failure detail per status', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('no', { status: 503 }))
      const host = createMockHostRuntime({ secrets: net.secrets })
      const res = await net.make().run(ctxFor(host))
      expect(res).toStrictEqual({ continuePipeline: true })
      const stats = await readDeliveryStats(host.kv, net.id)
      expect(stats?.ok).toBe(0)
      expect(stats?.error).toBe(1)
      expect(stats?.lastError).toBe('HTTP 503')
    })

    it('records a non-Error rejection as a generic network error, without throwing', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue('weird-non-error')
      const host = createMockHostRuntime({ secrets: net.secrets })
      const res = await net.make().run(ctxFor(host))
      expect(res).toStrictEqual({ continuePipeline: true })
      const stats = await readDeliveryStats(host.kv, net.id)
      expect(stats?.error).toBe(1)
      expect(stats?.lastError).toBe('network error')
    })
  })
}

describe('google-mp wire format', () => {
  it('POSTs the Measurement Protocol payload to the exact collect URL', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }))
    const host = createMockHostRuntime({
      secrets: { GOOGLE_MP_API_SECRET: 'g sec', GOOGLE_MEASUREMENT_ID: 'G-123' }
    })
    await createGoogleMpStrategy().run(ctxFor(host))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'https://www.google-analytics.com/mp/collect?measurement_id=G-123&api_secret=g%20sec'
    )
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'content-type': 'application/json' })
    expect(JSON.parse(init.body as string)).toEqual({
      client_id: 'site-1',
      events: [{ name: 'purchase', params: { engagement_time_msec: 1 } }]
    })
    const stats = await readDeliveryStats(host.kv, 'google-mp')
    expect(stats?.ok).toBe(1)
    expect(stats?.error).toBe(0)
  })
})

describe('meta-capi wire format', () => {
  it('POSTs the CAPI event with second-precision event_time and the request UA', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))
    const host = createMockHostRuntime({
      secrets: { META_ACCESS_TOKEN: 'mtok', META_PIXEL_ID: 'px9' }
    })
    await createMetaCapiStrategy().run(ctxFor(host))
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://graph.facebook.com/v19.0/px9/events')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'content-type': 'application/json' })
    expect(JSON.parse(init.body as string)).toEqual({
      data: [
        {
          event_name: 'purchase',
          event_time: Math.floor(new Date(tracking.occurredAt).getTime() / 1000),
          action_source: 'website',
          user_data: { client_user_agent: 'UA-under-test' }
        }
      ],
      access_token: 'mtok'
    })
  })

  it('falls back to an empty client_user_agent when the request has none', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))
    const host = createMockHostRuntime({
      secrets: { META_ACCESS_TOKEN: 'mtok', META_PIXEL_ID: 'px9' }
    })
    await createMetaCapiStrategy().run({
      host,
      request: new Request('https://x/'),
      tracking,
      consent: grantedConsent
    } as never)
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as {
      data: { user_data: { client_user_agent: string } }[]
    }
    expect(body.data[0]!.user_data.client_user_agent).toBe('')
  })
})

describe('microsoft-uet wire format', () => {
  it('POSTs the offline conversion with a Bearer token to the conversion API', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))
    const host = createMockHostRuntime({
      secrets: { MICROSOFT_UET_ACCESS_TOKEN: 'mstok', MICROSOFT_UET_TAG_ID: 'tag7' }
    })
    await createMicrosoftUetStrategy().run(ctxFor(host))
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://conversionapi.ads.microsoft.com/v1/offline/conversion')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      Authorization: 'Bearer mstok'
    })
    expect(JSON.parse(init.body as string)).toEqual({
      tagId: 'tag7',
      eventName: 'purchase',
      eventTime: '2026-07-25T10:00:00.000Z'
    })
    const stats = await readDeliveryStats(host.kv, 'microsoft-uet')
    expect(stats?.ok).toBe(1)
    expect(stats?.error).toBe(0)
  })
})

describe('tiktok-events wire format', () => {
  it('POSTs the event with the Access-Token header and attestrack callback context', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))
    const host = createMockHostRuntime({
      secrets: { TIKTOK_ACCESS_TOKEN: 'ttok', TIKTOK_PIXEL_ID: 'pix3' }
    })
    await createTikTokEventsStrategy().run(ctxFor(host))
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://business-api.tiktok.com/open_api/v1.3/event/track/')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      'Access-Token': 'ttok'
    })
    expect(JSON.parse(init.body as string)).toEqual({
      pixel_code: 'pix3',
      event: 'purchase',
      timestamp: '2026-07-25T10:00:00.000Z',
      context: { ad: { callback: 'attestrack' } }
    })
    const stats = await readDeliveryStats(host.kv, 'tiktok-events')
    expect(stats?.ok).toBe(1)
    expect(stats?.error).toBe(0)
  })
})
