import { describe, expect, it } from 'vitest'
import { createMockHostRuntime, destinationsAllowed, readDailyCounter } from '@attestrack/sdk'
import type { StrategyPipelineContext } from '@attestrack/sdk'
import { KV_KEY_OBS_BOTS_PREFIX } from '@attestrack/types'
import type { TrackingEventV1 } from '@attestrack/types'
import {
  BOT_SCORE_THRESHOLD,
  communityTrollShieldStrategy,
  evaluateBotHeuristics
} from '../src/mandatory/troll-shield.js'

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

function req(headers: Record<string, string> = {}): Request {
  return new Request('https://t.example.com/t/event', { method: 'POST', headers })
}

const tracking: TrackingEventV1 = {
  v: 1,
  eventName: 'page_view',
  siteId: 's1',
  occurredAt: '2026-07-25T10:00:00.000Z',
  userAgentClass: 'desktop'
}

describe('evaluateBotHeuristics (P3.4 — honest minimal checks)', () => {
  it('passes a normal browser UA', () => {
    const r = evaluateBotHeuristics(req({ 'user-agent': BROWSER_UA }), null)
    expect(r.isBot).toBe(false)
    expect(r.reasons).toEqual([])
  })

  it('flags well-known automation user agents', () => {
    for (const ua of [
      'curl/8.6.0',
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'python-requests/2.32.0',
      'HeadlessChrome/126.0',
      'Wget/1.21',
      'Scrapy/2.11 (+https://scrapy.org)'
    ]) {
      const r = evaluateBotHeuristics(req({ 'user-agent': ua }), null)
      expect(r.isBot, ua).toBe(true)
      expect(r.reasons).toContain('bot_user_agent')
    }
  })

  it('flags a missing User-Agent header', () => {
    const r = evaluateBotHeuristics(req(), null)
    expect(r.isBot).toBe(true)
    expect(r.reasons).toContain('missing_user_agent')
  })

  it('flags a low host bot score (Cloudflare passthrough) even with a clean UA', () => {
    const r = evaluateBotHeuristics(req({ 'user-agent': BROWSER_UA }), BOT_SCORE_THRESHOLD - 1)
    expect(r.isBot).toBe(true)
    expect(r.reasons).toEqual([`bot_score_${BOT_SCORE_THRESHOLD - 1}`])
  })

  it('does not flag a human-range or absent bot score', () => {
    expect(evaluateBotHeuristics(req({ 'user-agent': BROWSER_UA }), 99).isBot).toBe(false)
    expect(evaluateBotHeuristics(req({ 'user-agent': BROWSER_UA }), null).isBot).toBe(false)
    // Score 0 means "not computed" on Cloudflare — never a bot verdict.
    expect(evaluateBotHeuristics(req({ 'user-agent': BROWSER_UA }), 0).isBot).toBe(false)
  })
})

describe('communityTrollShieldStrategy (pipeline effects)', () => {
  it('publishes ctx.botDetection, relabels the tracking row, and counts the bot', async () => {
    const host = createMockHostRuntime()
    const ctx = {
      host,
      request: req({ 'user-agent': 'curl/8.6.0' }),
      tracking
    } as StrategyPipelineContext

    const result = await communityTrollShieldStrategy.run(ctx)
    expect(result.continuePipeline).toBe(true)
    expect(ctx.botDetection?.isBot).toBe(true)
    expect(result.tracking?.userAgentClass).toBe('bot')
    expect(await readDailyCounter(host.kv, KV_KEY_OBS_BOTS_PREFIX)).toBe(1)
  })

  it('leaves clean browser traffic untouched and uncounted', async () => {
    const host = createMockHostRuntime()
    const ctx = {
      host,
      request: req({ 'user-agent': BROWSER_UA }),
      tracking
    } as StrategyPipelineContext

    const result = await communityTrollShieldStrategy.run(ctx)
    expect(ctx.botDetection).toEqual({ isBot: false, reasons: [] })
    expect(result.tracking).toBeUndefined()
    expect(await readDailyCounter(host.kv, KV_KEY_OBS_BOTS_PREFIX)).toBe(0)
  })

  it('uses the host botScore port when present', async () => {
    const host = createMockHostRuntime({ botScore: 5 })
    const ctx = {
      host,
      request: req({ 'user-agent': BROWSER_UA })
    } as StrategyPipelineContext
    await communityTrollShieldStrategy.run(ctx)
    expect(ctx.botDetection?.isBot).toBe(true)
    expect(ctx.botDetection?.reasons).toEqual(['bot_score_5'])
  })

  it('bot-flagged traffic never fires destinations, regardless of consent (P3.4)', async () => {
    const host = createMockHostRuntime()
    const ctx = {
      host,
      request: req({ 'user-agent': 'curl/8.6.0' }),
      tracking,
      consent: { payload: { decision: 'granted' } }
    } as never as StrategyPipelineContext
    await communityTrollShieldStrategy.run(ctx)
    expect(destinationsAllowed(ctx)).toBe(false)
  })
})
