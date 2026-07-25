import { destinationsAllowed, type Strategy } from '@attestrack/sdk'
import type { StrategyManifest } from '@attestrack/types'

const manifest: StrategyManifest = {
  id: 'meta-capi',
  stage: 'destination',
  displayName: 'Meta Conversions API',
  defaultEnabled: false
}

export function createMetaCapiStrategy(): Strategy {
  return {
    id: 'meta-capi',
    stage: 'destination',
    manifest,
    async run(ctx) {
      if (!ctx.tracking) return { continuePipeline: true }
      // P2.3: the consent gate (mode + mechanism + GPC) decides, not raw token state.
      if (!destinationsAllowed(ctx)) return { continuePipeline: true }
      const token = ctx.host.getSecret('META_ACCESS_TOKEN')
      const pixelId = ctx.host.getSecret('META_PIXEL_ID')
      if (!token || !pixelId) return { continuePipeline: true }
      const url = `https://graph.facebook.com/v19.0/${pixelId}/events`
      const body = {
        data: [
          {
            event_name: ctx.tracking.eventName,
            event_time: Math.floor(new Date(ctx.tracking.occurredAt).getTime() / 1000),
            action_source: 'website',
            user_data: {
              client_user_agent: ctx.request.headers.get('user-agent') ?? ''
            }
          }
        ],
        access_token: token
      }
      try {
        await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        })
      } catch {
        /* isolated */
      }
      return { continuePipeline: true }
    }
  }
}
