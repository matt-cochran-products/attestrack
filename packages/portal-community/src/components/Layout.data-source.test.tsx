// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('../lib/api/delay', () => ({
  stubDelay: () => Promise.resolve()
}))

describe('Layout data source chrome (PORTAL.3 / REPO-SPEC-OSS)', () => {
  afterEach(() => {
    // Unmount the previous render BEFORE unstubbing the env / resetting modules.
    // Without this the first test's component stays mounted; when the next test
    // stubs a live Worker URL, its late async effect re-reads the leaked env and
    // renders a *second* "Live worker" label — a flaky "multiple elements" fail
    // that surfaces under CI timing (dev's suite is green by luck of ordering).
    cleanup()
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
    expect(screen.getByTitle('Showing sample data, not live data.')).toBeInTheDocument()
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

  it('production build with no runtime config shows a visible configuration error, not stub data', async () => {
    vi.stubEnv('VITE_ATTESTRACK_API_BASE_URL', '')
    vi.stubEnv('DEV', false)
    vi.stubEnv('PROD', true)
    vi.resetModules()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
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

    expect(await screen.findByText('Configuration error')).toBeInTheDocument()
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/Data is unavailable: this portal has a configuration error/)
    // Operator/implementation details live in docs/RUNTIME-CONFIG.md, not product UI.
    expect(alert).not.toHaveTextContent(/attestrack-portal-api|VITE_|meta|index\.html/i)
    expect(screen.queryByTitle(/attestrack-portal-api|VITE_|RUNTIME-CONFIG/i)).toBeNull()
    expect(screen.queryByText('Local stub data')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockRestore()
  })

  it('demo runtime meta is labelled as sample data', async () => {
    vi.stubEnv('VITE_ATTESTRACK_API_BASE_URL', '')
    vi.stubEnv('DEV', false)
    vi.stubEnv('PROD', true)
    vi.resetModules()
    const meta = document.createElement('meta')
    meta.setAttribute('name', 'attestrack-portal-api')
    meta.setAttribute('content', 'stub')
    document.head.appendChild(meta)
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

    expect(await screen.findByText('Demo — sample data')).toBeInTheDocument()
    meta.remove()
  })
})
