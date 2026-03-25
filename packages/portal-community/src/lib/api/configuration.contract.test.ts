import { afterEach, describe, expect, it, vi } from 'vitest'
import { PORTAL_WORKER_PREFIX } from './constants'

describe('configuration live API paths', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('updateMode posts to PORTAL_WORKER_PREFIX site-config/mode', async () => {
    vi.stubEnv('VITE_ATTESTRACK_API_BASE_URL', 'https://w.example.com')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )
    const { updateMode } = await import('./configuration')
    await updateMode('ENFORCEMENT')
    expect(fetchMock).toHaveBeenCalledWith(
      `https://w.example.com${PORTAL_WORKER_PREFIX}/site-config/mode`,
      expect.objectContaining({ method: 'POST' })
    )
  })
})
