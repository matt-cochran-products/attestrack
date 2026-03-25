import { afterEach, describe, expect, it, vi } from 'vitest'

describe('http client contract — stub vs live (PORTAL.3)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('isLiveApi is false when VITE_ATTESTRACK_API_BASE_URL is unset', async () => {
    vi.stubEnv('VITE_ATTESTRACK_API_BASE_URL', '')
    const { isLiveApi, getApiBase } = await import('./http')
    expect(getApiBase()).toBe('')
    expect(isLiveApi()).toBe(false)
  })

  it('isLiveApi is true when base URL is set', async () => {
    vi.stubEnv('VITE_ATTESTRACK_API_BASE_URL', 'https://worker.example.com')
    const { isLiveApi, getApiBase } = await import('./http')
    expect(isLiveApi()).toBe(true)
    expect(getApiBase()).toBe('https://worker.example.com')
  })

  it('strips trailing slash from base URL', async () => {
    vi.stubEnv('VITE_ATTESTRACK_API_BASE_URL', 'https://worker.example.com/')
    const { getApiBase } = await import('./http')
    expect(getApiBase()).toBe('https://worker.example.com')
  })
})
