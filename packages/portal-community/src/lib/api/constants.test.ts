import { describe, expect, it } from 'vitest'
import { PORTAL_WORKER_PREFIX } from './constants'

describe('PORTAL_WORKER_PREFIX', () => {
  it('matches worker-core portal route prefix', () => {
    expect(PORTAL_WORKER_PREFIX).toBe('/__attestrack__/portal/v1')
  })
})
