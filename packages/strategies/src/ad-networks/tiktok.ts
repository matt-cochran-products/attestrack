import { destinationsAllowed, type Strategy } from '@attestrack/sdk'
import type { StrategyManifest } from '@attestrack/types'

const manifest: StrategyManifest = {
  id: 'tiktok-events',
  stage: 'destination',
  displayName: 'TikTok Events API',
  defaultEnabled: false
}

export function createTikTokEventsStrategy(): Strategy {
  return {
    id: 'tiktok-events',
    stage: 'destination',
    manifest,
    async run(ctx) {
      if (!ctx.tracking) return { continuePipeline: true }
      // P2.3: the consent gate (mode + mechanism + GPC) decides, not raw token state.
      if (!destinationsAllowed(ctx)) return { continuePipeline: true }
      const access = ctx.host.getSecret('TIKTOK_ACCESS_TOKEN')
      const pixel = ctx.host.getSecret('TIKTOK_PIXEL_ID')
      if (!access || !pixel) return { continuePipeline: true }
      const url = 'https://business-api.tiktok.com/open_api/v1.3/event/track/'
      try {
        await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'Access-Token': access
          },
          body: JSON.stringify({
            pixel_code: pixel,
            event: ctx.tracking.eventName,
            timestamp: ctx.tracking.occurredAt,
            context: { ad: { callback: 'attestrack' } }
          })
        })
      } catch {
        /* isolated */
      }
      return { continuePipeline: true }
    }
  }
}
