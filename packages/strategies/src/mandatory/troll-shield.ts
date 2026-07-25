import { incrementDailyCounter, type Strategy, type StrategyPipelineContext, type StrategyResult } from '@attestrack/sdk'
import type { StrategyManifest } from '@attestrack/types'
import { KV_KEY_OBS_BOTS_PREFIX } from '@attestrack/types'

/**
 * Community troll-shield (P3.4): minimal HONEST bot heuristics — no scoring
 * theater, no invented intelligence. A request is flagged when any of:
 *
 * 1. **UA class** — the User-Agent matches a well-known automation/crawler
 *    pattern (curl, headless browsers, spiders, HTTP libraries).
 * 2. **Missing headers** — no User-Agent at all: every real browser sends one
 *    on tracking POSTs; server scripts frequently do not.
 * 3. **Host bot score** — optional passthrough via the host port
 *    (`host.botScore`); on Cloudflare this is Bot Management's score where
 *    1–29 means "likely automated". No-ops when the host has no score.
 *
 * Effect (Invariant: detection never blocks the pipeline):
 * - `ctx.botDetection` is published; `destinationsAllowed` then keeps ad
 *   destinations from firing for flagged traffic.
 * - The tracking row is relabeled `userAgentClass: 'bot'` so warehouse
 *   analytics keep the request visible instead of silently dropping it.
 * - A per-UTC-day counter (`attestrack:obs:bots:`) feeds the portal's
 *   bot-filter figure — the only signal-view number that is real in v1.
 *
 * Known tradeoff: substring UA matching can rarely misclassify exotic real
 * browsers (e.g. devices with "bot" in the model name). The blast radius is
 * ad-destination suppression + labeling — never data loss.
 */
export const communityTrollShieldStrategyManifest: StrategyManifest = {
  id: 'troll-shield',
  stage: 'mandatory',
  displayName: 'Troll shield — bot heuristics (community)'
}

const BOT_UA_PATTERN =
  /(bot|crawler|crawling|spider|slurp|headless|phantomjs|selenium|puppeteer|playwright|curl\/|wget\/|python-requests|python-urllib|aiohttp|go-http-client|okhttp|httpclient|libwww|scrapy|java\/|node-fetch|axios\/)/i

/** Cloudflare Bot Management convention: scores 1–29 are "likely automated". */
export const BOT_SCORE_THRESHOLD = 30

/** Pure heuristic evaluation (exported for tests). */
export function evaluateBotHeuristics(
  request: Request,
  botScore: number | null
): { isBot: boolean; reasons: string[] } {
  const reasons: string[] = []
  const ua = request.headers.get('user-agent')
  if (ua === null || ua.trim() === '') {
    reasons.push('missing_user_agent')
  } else if (BOT_UA_PATTERN.test(ua)) {
    reasons.push('bot_user_agent')
  }
  if (botScore !== null && botScore > 0 && botScore < BOT_SCORE_THRESHOLD) {
    reasons.push(`bot_score_${botScore}`)
  }
  return { isBot: reasons.length > 0, reasons }
}

export const communityTrollShieldStrategy: Strategy = {
  id: 'troll-shield',
  stage: 'mandatory',
  manifest: communityTrollShieldStrategyManifest,
  async run(ctx: StrategyPipelineContext): Promise<StrategyResult> {
    const score = ctx.host.botScore?.(ctx.request) ?? null
    const detection = evaluateBotHeuristics(ctx.request, score)
    ctx.botDetection = detection
    if (!detection.isBot) {
      return { continuePipeline: true }
    }
    // Real counter for the portal bot-filter figure (best-effort, never throws).
    await incrementDailyCounter(ctx.host.kv, KV_KEY_OBS_BOTS_PREFIX)
    if (ctx.tracking) {
      return {
        continuePipeline: true,
        tracking: { ...ctx.tracking, userAgentClass: 'bot' }
      }
    }
    return { continuePipeline: true }
  }
}
