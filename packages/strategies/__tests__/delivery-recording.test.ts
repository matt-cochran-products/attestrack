import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockHostRuntime, readDeliveryStats } from '@attestrack/sdk'
import type { TrackingEventV1 } from '@attestrack/types'
import { createMetaCapiStrategy } from '../src/ad-networks/meta.js'
import { createTinybirdStrategy } from '../src/analytics/tinybird.js'

const tracking: TrackingEventV1 = {
  v: 1,
  eventName: 'purchase',
  siteId: 's1',
  occurredAt: '2026-07-25T10:00:00.000Z'
}

afterEach(() => vi.restoreAllMocks())

describe('P3.1 delivery-result recording (STR.4 error surface)', () => {
  it('meta-capi records success when the CAPI call returns 2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    const host = createMockHostRuntime({
      secrets: { META_ACCESS_TOKEN: 't', META_PIXEL_ID: 'p' }
    })
    await createMetaCapiStrategy().run({
      host,
      request: new Request('https://x/'),
      tracking,
      consent: { payload: { decision: 'granted' } }
    } as never)
    const stats = await readDeliveryStats(host.kv, 'meta-capi')
    expect(stats?.ok).toBe(1)
    expect(stats?.error).toBe(0)
  })

  it('meta-capi records an error with status detail on a non-2xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 403 }))
    const host = createMockHostRuntime({
      secrets: { META_ACCESS_TOKEN: 't', META_PIXEL_ID: 'p' }
    })
    await createMetaCapiStrategy().run({
      host,
      request: new Request('https://x/'),
      tracking,
      consent: { payload: { decision: 'granted' } }
    } as never)
    const stats = await readDeliveryStats(host.kv, 'meta-capi')
    expect(stats?.error).toBe(1)
    expect(stats?.lastError).toBe('HTTP 403')
  })

  it('meta-capi records nothing when unconfigured (no attempt, no stats)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const host = createMockHostRuntime({ secrets: {} })
    await createMetaCapiStrategy().run({
      host,
      request: new Request('https://x/'),
      tracking,
      consent: { payload: { decision: 'granted' } }
    } as never)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(await readDeliveryStats(host.kv, 'meta-capi')).toBeNull()
  })

  it('meta-capi records nothing when the consent gate blocks (no delivery attempt)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const host = createMockHostRuntime({
      secrets: { META_ACCESS_TOKEN: 't', META_PIXEL_ID: 'p' }
    })
    await createMetaCapiStrategy().run({
      host,
      request: new Request('https://x/'),
      tracking,
      consent: null
    } as never)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(await readDeliveryStats(host.kv, 'meta-capi')).toBeNull()
  })

  it('tinybird records a network failure without throwing', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('dns fail'))
    const host = createMockHostRuntime({ secrets: { TINYBIRD_TOKEN: 'tok' } })
    const res = await createTinybirdStrategy().run({
      host,
      request: new Request('https://x/'),
      tracking
    } as never)
    expect(res).toEqual({ continuePipeline: true })
    const stats = await readDeliveryStats(host.kv, 'tinybird')
    expect(stats?.error).toBe(1)
    expect(stats?.lastError).toBe('dns fail')
  })

  it('tinybird records success on 2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 202 }))
    const host = createMockHostRuntime({ secrets: { TINYBIRD_TOKEN: 'tok' } })
    await createTinybirdStrategy().run({
      host,
      request: new Request('https://x/'),
      tracking
    } as never)
    const stats = await readDeliveryStats(host.kv, 'tinybird')
    expect(stats?.ok).toBe(1)
  })
})
