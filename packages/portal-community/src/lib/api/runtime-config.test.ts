import { describe, expect, it } from 'vitest'
import { parseStrictOrigin, resolvePortalDataSource, type DataSourceInputs } from './runtime-config'

const PAGE = 'https://portal.example.com'

function inputs(over: Partial<DataSourceInputs>): DataSourceInputs {
  return { metaContents: [], pageOrigin: PAGE, legacyBaseUrl: undefined, isDev: false, ...over }
}

describe('resolvePortalDataSource — runtime meta', () => {
  it('same-origin meta resolves to the page origin only', () => {
    expect(resolvePortalDataSource(inputs({ metaContents: ['same-origin'] }))).toEqual({
      kind: 'live',
      base: PAGE,
      source: 'runtime-meta',
    })
  })

  it('runtime meta takes precedence over a valid legacy build env', () => {
    const ds = resolvePortalDataSource(
      inputs({ metaContents: ['same-origin'], legacyBaseUrl: 'https://worker.example.net' }),
    )
    expect(ds).toEqual({ kind: 'live', base: PAGE, source: 'runtime-meta' })
  })

  it('explicit stub meta is a labelled demo, even in production', () => {
    expect(resolvePortalDataSource(inputs({ metaContents: ['stub'] }))).toEqual({ kind: 'stub', reason: 'demo' })
  })

  it.each([
    'https://evil.example.com',
    '//evil.example.com',
    'https://user:pass@portal.example.com',
    'https://portal.example.com/?x=1',
    'https://portal.example.com/#frag',
    '/__attestrack__/portal/v1',
    'javascript:alert(1)',
    'SAME-ORIGIN',
    ' same-origin',
    '',
  ])('invalid meta %j is misconfigured and never falls back to legacy env or stubs', (content) => {
    for (const isDev of [true, false]) {
      const ds = resolvePortalDataSource(
        inputs({ metaContents: [content], legacyBaseUrl: 'https://worker.example.net', isDev }),
      )
      expect(ds.kind).toBe('misconfigured')
      if (ds.kind === 'misconfigured') expect(ds.source).toBe('runtime-meta')
    }
  })

  it('duplicate meta elements are misconfigured (no first-wins ambiguity)', () => {
    const ds = resolvePortalDataSource(inputs({ metaContents: ['same-origin', 'stub'], isDev: true }))
    expect(ds.kind).toBe('misconfigured')
  })

  it.each(['null', 'file://', 'http://portal.example.com'])(
    'same-origin on an unusable page origin %j is misconfigured',
    (pageOrigin) => {
      expect(resolvePortalDataSource(inputs({ metaContents: ['same-origin'], pageOrigin })).kind).toBe(
        'misconfigured',
      )
    },
  )

  it('same-origin on a loopback http page is allowed for local wrangler/e2e hosts', () => {
    const ds = resolvePortalDataSource(inputs({ metaContents: ['same-origin'], pageOrigin: 'http://localhost:8788' }))
    expect(ds).toEqual({ kind: 'live', base: 'http://localhost:8788', source: 'runtime-meta' })
  })
})

describe('resolvePortalDataSource — legacy build env and defaults', () => {
  it('valid legacy https origin stays live (deploy CLI compatibility)', () => {
    expect(resolvePortalDataSource(inputs({ legacyBaseUrl: 'https://worker.example.net/' }))).toEqual({
      kind: 'live',
      base: 'https://worker.example.net',
      source: 'build-env',
    })
  })

  it('invalid legacy value is misconfigured even in dev — no stub fallback', () => {
    const ds = resolvePortalDataSource(inputs({ legacyBaseUrl: 'http://worker.example.net', isDev: true }))
    expect(ds.kind).toBe('misconfigured')
  })

  it('nothing configured in production fails closed', () => {
    const ds = resolvePortalDataSource(inputs({}))
    expect(ds.kind).toBe('misconfigured')
    if (ds.kind === 'misconfigured') expect(ds.source).toBe('none')
  })

  it('nothing configured in dev keeps local stub data', () => {
    expect(resolvePortalDataSource(inputs({ isDev: true }))).toEqual({ kind: 'stub', reason: 'local-dev' })
  })
})

describe('parseStrictOrigin', () => {
  it.each([
    ['https://w.example.com/path', /path/],
    ['https://w.example.com?q', /query/],
    ['https://w.example.com#h', /fragment/],
    ['https://a@w.example.com', /userinfo/],
    ['//w.example.com', /protocol-relative/],
    ['https://w.example.com\\@evil.com', /backslash/],
    ['ftp://w.example.com', /scheme/],
    ['http://w.example.com', /scheme/],
    ['not a url', /whitespace/],
  ])('rejects %j', (raw, why) => {
    const r = parseStrictOrigin(raw, true)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(why)
  })

  it('rejects http loopback when not allowed', () => {
    expect(parseStrictOrigin('http://localhost:8788', false).ok).toBe(false)
  })
})
