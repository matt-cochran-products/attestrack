import { describe, expect, it } from 'vitest'
import { validateAcceptanceEvidence, type DashboardAcceptanceEvidence } from './evidence'

/**
 * Synthetic, clearly-fictional records used to exercise the validator's
 * structure rules. Passing these proves nothing about any deployment.
 */
const H = (c: string) => c.repeat(64)
const ORIGIN = 'https://portal.acme-staging.dev'
const T0 = Date.parse('2026-10-24T12:00:00.000Z')
const at = (s: number) => new Date(T0 + s * 1000).toISOString()

function validRecord(): DashboardAcceptanceEvidence {
  return {
    schema: 'attestrack.dashboard-acceptance/v1',
    marker: { value: 'ATK-FICTIONAL-k3v9q2m7x1z8w4r6', fictional: true },
    window: { startedAt: at(0), endedAt: at(55) },
    identity: {
      sourceCommit: '1f2e3d4c5b6a7980112233445566778899aabbcc',
      portalArtifact: { name: '@attestrack/portal-community/dist', sha256: H('a') },
      workerArtifact: { name: 'attestrack-worker', sha256: H('b') },
      runtimeConfig: {
        mechanism: 'html-meta',
        metaName: 'attestrack-portal-api',
        metaContent: 'same-origin',
        hostHtmlSha256: H('c'),
      },
      environment: 'staging',
      portalOrigin: ORIGIN,
    },
    warehouseRow: {
      source: 'warehouse-readback',
      table: 'events',
      eventId: '0c9e7d1a-4b2f-4e8a-9d3c-7f6b5a4e3d2c',
      receivedAt: at(5),
      observedAt: at(20),
      markerReadBack: 'ATK-FICTIONAL-k3v9q2m7x1z8w4r6',
      readbackRef: { ref: 'warehouse/readback.json', sha256: H('d'), mediaType: 'application/json' },
    },
    exploreResponse: {
      method: 'POST',
      path: '/__attestrack__/portal/v1/explore/query',
      requestOrigin: ORIGIN,
      credentialsMode: 'include',
      authentication: 'cloudflare-access-session',
      status: 200,
      rowCount: 1,
      markerInResponse: 'ATK-FICTIONAL-k3v9q2m7x1z8w4r6',
      responseSha256: H('e'),
      observedAt: at(30),
      harRef: { ref: 'har/explore.har', sha256: H('f'), mediaType: 'application/har+json' },
    },
    screenshots: [
      {
        id: 'shot-explore',
        shows: 'explore-result-with-marker',
        capturedAt: at(31),
        image: { ref: 'screens/explore.png', sha256: H('1'), mediaType: 'image/png' },
      },
      {
        id: 'shot-ui',
        shows: 'ui-transport-marker',
        capturedAt: at(32),
        image: { ref: 'screens/ui.png', sha256: H('2'), mediaType: 'image/png' },
      },
    ],
    uiTransport: {
      marker: 'ATK-UI-p0o9i8u7y6t5r4e3',
      dataSourceLabel: 'Live worker',
      observedAt: at(32),
      screenshotId: 'shot-ui',
    },
    negatives: {
      consentDeclined: {
        outcome: 'not-delivered',
        status: 204,
        observedAt: at(40),
        ref: { ref: 'neg/consent.json', sha256: H('3'), mediaType: 'application/json' },
      },
      unknownSite: {
        outcome: 'rejected',
        status: 404,
        observedAt: at(42),
        ref: { ref: 'neg/site.json', sha256: H('4'), mediaType: 'application/json' },
      },
      accessUnauthenticated: {
        outcome: 'redirected-to-access-login',
        status: 302,
        observedAt: at(44),
        ref: { ref: 'neg/access.json', sha256: H('5'), mediaType: 'application/json' },
      },
      directOrigin: {
        outcome: 'denied',
        status: 403,
        observedAt: at(46),
        ref: { ref: 'neg/direct.json', sha256: H('6'), mediaType: 'application/json' },
      },
    },
  }
}

type Mutable = Record<string, unknown>
function mutate(fn: (r: Mutable) => void): unknown {
  const r = structuredClone(validRecord()) as unknown as Mutable
  fn(r)
  return r
}
const get = (r: Mutable, k: string) => r[k] as Mutable

function expectRejected(input: unknown, match: RegExp) {
  const res = validateAcceptanceEvidence(input)
  expect(res.ok).toBe(false)
  expect(res.liveAcceptanceClaimed).toBe(false)
  if (!res.ok) expect(res.errors.join('\n')).toMatch(match)
}

describe('validateAcceptanceEvidence', () => {
  it('accepts a complete, consistent record as a structural candidate only', () => {
    const res = validateAcceptanceEvidence(validRecord())
    expect(res).toMatchObject({ ok: true, status: 'evidence-structurally-valid', liveAcceptanceClaimed: false })
  })

  it.each([true, { passed: true }, { accepted: true }, { status: 200 }, null, 'ok'])(
    'rejects booleans / bare success flags %j',
    (input) => {
      expect(validateAcceptanceEvidence(input).ok).toBe(false)
    },
  )

  it('rejects an extra boolean flag on an otherwise valid record', () => {
    expectRejected(mutate((r) => (r.accepted = true)), /\$\.accepted: unknown field/)
  })

  it('rejects an ingest 200/accepted response or health probe in place of a warehouse row', () => {
    expectRejected(mutate((r) => (get(r, 'warehouseRow').source = 'ingest-accepted-200')), /warehouseRow\.source/)
    expectRejected(mutate((r) => (get(r, 'warehouseRow').source = 'health')), /warehouseRow\.source/)
  })

  it('rejects fixture references and non-fictional markers', () => {
    expectRejected(
      mutate((r) => (get(get(r, 'warehouseRow'), 'readbackRef').ref = 'fixtures/row.json')),
      /fixture/,
    )
    expectRejected(mutate((r) => (get(r, 'marker').value = 'order-12345')), /marker\.value/)
  })

  it('requires the warehouse row and Explore response to echo the same marker', () => {
    expectRejected(
      mutate((r) => (get(r, 'warehouseRow').markerReadBack = 'ATK-FICTIONAL-zzzzzzzzzzzzzzzz')),
      /markerReadBack: does not equal/,
    )
    expectRejected(
      mutate((r) => (get(r, 'exploreResponse').markerInResponse = 'ATK-FICTIONAL-zzzzzzzzzzzzzzzz')),
      /markerInResponse: does not equal/,
    )
  })

  it('rejects an empty Explore 200 and a cross-origin Explore request', () => {
    expectRejected(mutate((r) => (get(r, 'exploreResponse').rowCount = 0)), /rowCount/)
    expectRejected(
      mutate((r) => (get(r, 'exploreResponse').requestOrigin = 'https://worker.acme-staging.dev')),
      /requestOrigin: not the portal origin/,
    )
  })

  it('requires a separate UI transport marker that references a screenshot', () => {
    expectRejected(
      mutate((r) => (get(r, 'uiTransport').marker = 'ATK-UI-k3v9q2m7x1z8w4r6')),
      /independent of the data marker/,
    )
    expectRejected(mutate((r) => (get(r, 'uiTransport').screenshotId = 'missing')), /does not reference/)
  })

  it('rejects windows over 60s and observations outside the window', () => {
    expectRejected(mutate((r) => (get(r, 'window').endedAt = at(61))), /exceeds 60s/)
    expectRejected(mutate((r) => (get(r, 'exploreResponse').observedAt = at(58))), /outside the acceptance window/)
  })

  it('requires all four negative outcomes with demonstrating statuses', () => {
    expectRejected(mutate((r) => delete get(r, 'negatives').directOrigin), /directOrigin: required/)
    expectRejected(mutate((r) => (get(get(r, 'negatives'), 'directOrigin').status = 200)), /directOrigin\.status/)
    expectRejected(
      mutate((r) => (get(get(r, 'negatives'), 'accessUnauthenticated').status = 200)),
      /accessUnauthenticated\.status/,
    )
  })

  it('requires exact source / artifact / runtime-config identity', () => {
    expectRejected(mutate((r) => (get(r, 'identity').sourceCommit = 'main')), /sourceCommit/)
    expectRejected(
      mutate((r) => (get(get(r, 'identity'), 'runtimeConfig').metaContent = 'https://worker.acme-staging.dev')),
      /metaContent/,
    )
    expectRejected(mutate((r) => (get(r, 'identity').portalOrigin = 'https://portal.example.com')), /example origins/)
  })

  it('rejects raw tokens, cookies and personal data anywhere in the record', () => {
    expectRejected(
      mutate((r) => (get(r, 'warehouseRow').eventId = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0')),
      /JWT-like token/,
    )
    expectRejected(
      mutate((r) => (get(get(r, 'identity'), 'workerArtifact').name = 'CF_Authorization')),
      /Cloudflare Access credential/,
    )
    expectRejected(mutate((r) => (get(r, 'uiTransport').screenshotId = 'jane.doe@customer.com')), /email address/)
  })

  it('names the row timestamp receivedAt (canonical events column) and rejects the old insertedAt key', () => {
    expectRejected(
      mutate((r) => {
        const wr = get(r, 'warehouseRow')
        wr.insertedAt = wr.receivedAt
        delete wr.receivedAt
      }),
      /warehouseRow\.insertedAt: unknown field[\s\S]*warehouseRow\.receivedAt: required/,
    )
    expectRejected(
      mutate((r) => (get(r, 'warehouseRow').observedAt = at(4))),
      /read back before the row was received/,
    )
  })

  describe('bounded structure — never throws', () => {
    it('rejects a self-referencing record without throwing', () => {
      const r = validRecord() as unknown as Mutable
      get(r, 'warehouseRow').self = r
      expect(() => validateAcceptanceEvidence(r)).not.toThrow()
      expectRejected(r, /\$\.warehouseRow\.self: cyclic reference/)
    })

    it('rejects a cycle through an array', () => {
      const loop: unknown[] = []
      loop.push(loop)
      expectRejected(mutate((r) => (r.screenshots = loop)), /\$\.screenshots\[0\]: cyclic reference/)
    })

    it('rejects pathologically deep nesting without throwing', () => {
      let deep: unknown = 'x'
      for (let i = 0; i < 100_000; i++) deep = { d: deep }
      const r = mutate((rec) => (rec.negatives = deep))
      expect(() => validateAcceptanceEvidence(r)).not.toThrow()
      expectRejected(r, /nested deeper than 16 levels/)
    })

    it('rejects oversized input', () => {
      expectRejected(mutate((r) => (r.screenshots = new Array(5_000).fill('x'))), /exceeds 2000 values/)
    })

    it('still treats shared (non-cyclic) references as data and never claims live acceptance', () => {
      const r = validRecord()
      const shared = { ref: 'neg/shared.json', sha256: H('7'), mediaType: 'application/json' as const }
      r.negatives.unknownSite.ref = shared
      r.negatives.directOrigin.ref = shared
      expect(validateAcceptanceEvidence(r)).toMatchObject({
        ok: true,
        status: 'evidence-structurally-valid',
        liveAcceptanceClaimed: false,
      })
    })
  })
})
