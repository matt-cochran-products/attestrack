import { describe, expect, it, vi } from 'vitest'
import {
  runDestinationStrategiesParallel,
  runMandatoryStrategies
} from '../src/composite.js'
import type { Strategy } from '@attestrack/sdk'
import { createMockHostRuntime } from '@attestrack/sdk'

describe('runMandatoryStrategies', () => {
  it('isolates troll-shield failures', async () => {
    const host = createMockHostRuntime()
    const ctx = { host, request: new Request('https://x/') }
    const calls: string[] = []
    const boom: Strategy = {
      id: 'troll-shield',
      stage: 'mandatory',
      async run() {
        calls.push('troll')
        throw new Error('fail')
      }
    }
    const next: Strategy = {
      id: 'after',
      stage: 'mandatory',
      async run() {
        calls.push('after')
        return { continuePipeline: true }
      }
    }
    await runMandatoryStrategies(ctx, [boom, next])
    expect(calls).toEqual(['troll', 'after'])
  })
})

describe('runDestinationStrategiesParallel', () => {
  it('runs destinations concurrently and isolates errors', async () => {
    const host = createMockHostRuntime()
    const ctx = { host, request: new Request('https://x/') }
    const a: Strategy = {
      id: 'a',
      stage: 'destination',
      async run() {
        await new Promise((r) => setTimeout(r, 20))
        return { continuePipeline: true }
      }
    }
    const b: Strategy = {
      id: 'b',
      stage: 'destination',
      async run() {
        throw new Error('x')
      }
    }
    const spy = vi.fn()
    const c: Strategy = {
      id: 'c',
      stage: 'destination',
      async run() {
        spy()
        return { continuePipeline: true }
      }
    }
    await runDestinationStrategiesParallel(ctx, [a, b, c])
    expect(spy).toHaveBeenCalled()
  })
})
