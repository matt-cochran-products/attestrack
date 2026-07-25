import { describe, expect, it } from 'vitest'
import { runStrategiesForStage } from '../src/composite.js'
import type { Strategy } from '@attestrack/sdk'
import { createMockHostRuntime } from '@attestrack/sdk'

describe('runStrategiesForStage', () => {
  it('runs strategies in order and merges context', async () => {
    const host = createMockHostRuntime()
    const ctx = {
      host,
      request: new Request('https://x.test/')
    }
    const calls: string[] = []
    const a: Strategy = {
      id: 'a',
      stage: 'mandatory',
      async run() {
        calls.push('a')
        return { continuePipeline: true, consent: null }
      }
    }
    const b: Strategy = {
      id: 'b',
      stage: 'mandatory',
      async run() {
        calls.push('b')
        return { continuePipeline: true, consent: null }
      }
    }
    await runStrategiesForStage('mandatory', ctx, [a, b])
    expect(calls).toEqual(['a', 'b'])
  })
})
