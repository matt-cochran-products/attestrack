import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockHostRuntime } from '@attestrue/sdk'
import { createOtelStrategy } from '../src/analytics/otel.js'

const tracking = {
  v: 1 as const,
  eventName: 'cta_click',
  siteId: 'pubops',
  occurredAt: '2026-07-25T10:00:00.000Z',
  sessionId: 's1',
  pagePath: '/posture',
  ctaType: 'request-audit',
  webVitalName: 'lcp',
  webVitalValue: 1240.5
}

afterEach(() => vi.restoreAllMocks())

describe('createOtelStrategy', () => {
  it('no-ops (and never throws) when the OTLP endpoint secret is unset', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const host = createMockHostRuntime({ secrets: {} })
    const res = await createOtelStrategy().run({ host, request: new Request('https://x/'), tracking } as never)
    expect(res).toEqual({ continuePipeline: true })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('POSTs one OTLP log to <endpoint>/v1/logs with the event promoted to attributes', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))
    const host = createMockHostRuntime({
      secrets: { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318', OTEL_SERVICE_NAME: 'attestrue' }
    })

    await createOtelStrategy().run({ host, request: new Request('https://x/'), tracking } as never)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('http://collector:4318/v1/logs')
    const body = JSON.parse((init as RequestInit).body as string)
    const record = body.resourceLogs[0].scopeLogs[0].logRecords[0]
    expect(record.body.stringValue).toBe('cta_click')
    const attrs = Object.fromEntries(
      record.attributes.map((a: { key: string; value: Record<string, unknown> }) => [
        a.key,
        Object.values(a.value)[0]
      ])
    )
    // High-level fields are promoted onto the log record (bounded set).
    expect(attrs.ctaType).toBe('request-audit')
    expect(attrs.webVitalName).toBe('lcp')
    expect(attrs.webVitalValue).toBe(1240.5)
    expect(attrs.sessionId).toBe('s1')
    expect(attrs['event.name']).toBe('cta_click')
    // service.name rides on the resource.
    expect(body.resourceLogs[0].resource.attributes[0].value.stringValue).toBe('attestrue')
  })

  it('swallows transport errors (analytics must not throw)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'))
    const host = createMockHostRuntime({
      secrets: { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318' }
    })
    const res = await createOtelStrategy().run({ host, request: new Request('https://x/'), tracking } as never)
    expect(res).toEqual({ continuePipeline: true })
  })
})
