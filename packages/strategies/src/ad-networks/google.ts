import { destinationsAllowed, type Strategy } from '@attestrack/sdk'
import type { StrategyManifest } from '@attestrack/types'

const manifest: StrategyManifest = {
  id: 'google-mp',
  stage: 'destination',
  displayName: 'Google Measurement Protocol',
  defaultEnabled: false
}

export function createGoogleMpStrategy(): Strategy {
  return {
    id: 'google-mp',
    stage: 'destination',
    manifest,
    async run(ctx) {
      if (!ctx.tracking) return { continuePipeline: true }
      // P2.3: the consent gate (mode + mechanism + GPC) decides, not raw token state.
      if (!destinationsAllowed(ctx)) return { continuePipeline: true }
      const secret = ctx.host.getSecret('GOOGLE_MP_API_SECRET')
      const id = ctx.host.getSecret('GOOGLE_MEASUREMENT_ID')
      if (!secret || !id) return { continuePipeline: true }
      const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(id)}&api_secret=${encodeURIComponent(secret)}`
      const body = {
        client_id: ctx.tracking.siteId,
        events: [{ name: ctx.tracking.eventName, params: { engagement_time_msec: 1 } }]
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
