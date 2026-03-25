import type { Strategy } from '@attestrue/sdk'
import type { StrategyManifest } from '@attestrue/types'

const manifest: StrategyManifest = {
  id: 'microsoft-uet',
  stage: 'destination',
  displayName: 'Microsoft UET offline conversions',
  defaultEnabled: false
}

export function createMicrosoftUetStrategy(): Strategy {
  return {
    id: 'microsoft-uet',
    stage: 'destination',
    manifest,
    async run(ctx) {
      if (!ctx.tracking) return { continuePipeline: true }
      if (ctx.consent?.payload.decision !== 'granted') return { continuePipeline: true }
      const token = ctx.host.getSecret('MICROSOFT_UET_ACCESS_TOKEN')
      const tagId = ctx.host.getSecret('MICROSOFT_UET_TAG_ID')
      if (!token || !tagId) return { continuePipeline: true }
      try {
        await fetch('https://conversionapi.ads.microsoft.com/v1/offline/conversion', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            tagId,
            eventName: ctx.tracking.eventName,
            eventTime: ctx.tracking.occurredAt
          })
        })
      } catch {
        /* isolated */
      }
      return { continuePipeline: true }
    }
  }
}
