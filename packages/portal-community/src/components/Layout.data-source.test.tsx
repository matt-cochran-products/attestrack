// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../lib/api/delay', () => ({
  stubDelay: () => Promise.resolve()
}))

describe('Layout data source chrome (PORTAL.3 / REPO-SPEC-OSS)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('shows Local stub data when Worker base URL is unset', async () => {
    vi.stubEnv('VITE_ATTESTRACK_API_BASE_URL', '')
    vi.resetModules()
    const { MemoryRouter } = await import('react-router-dom')
    const { Layout } = await import('./Layout')
    const { PortalShellProvider } = await import('../context/PortalShellContext')

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <PortalShellProvider>
          <Layout>
            <div>child</div>
          </Layout>
        </PortalShellProvider>
      </MemoryRouter>
    )

    expect(await screen.findByText('Local stub data')).toBeInTheDocument()
    expect(screen.getByTitle(/VITE_ATTESTRACK_API_BASE_URL/i)).toBeInTheDocument()
  })

  it('shows Live worker when VITE_ATTESTRACK_API_BASE_URL is set', async () => {
    vi.stubEnv('VITE_ATTESTRACK_API_BASE_URL', 'https://t.example.com')
    vi.resetModules()
    const { MemoryRouter } = await import('react-router-dom')
    const { Layout } = await import('./Layout')
    const { PortalShellProvider } = await import('../context/PortalShellContext')

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <PortalShellProvider>
          <Layout>
            <div>child</div>
          </Layout>
        </PortalShellProvider>
      </MemoryRouter>
    )

    expect(await screen.findByText('Live worker')).toBeInTheDocument()
  })
})
