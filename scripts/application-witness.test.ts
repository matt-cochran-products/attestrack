import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { configuredTarget, observe, inspect, type PreparedPhase, type Artifact, type Phase, type Witness } from './application-witness.ts'

const target = { origin: 'https://fixture.invalid', site_id: 'dedicated-fixture', policy_hash: 'a'.repeat(64) }
const artifact: Artifact = { artifact_id: 1, producer_run: 2, producer_attempt: 1, archive_sha256: 'b'.repeat(64), inventory_sha256: 'c'.repeat(64), source_tree: 'd'.repeat(40) }
function mutation(cohort: string = randomUUID()) { return { cohort, event_id: randomUUID() } }
const fixture = { portal_secret: 'synthetic-portal-fixture-secret' }
function server(options: { wrongSite?: boolean; anonymousAllowed?: boolean; truncated?: boolean; duplicate?: boolean; failEvent?: boolean; missingOld?: boolean; leak?: boolean } = {}) {
  const rows: Record<string, string>[] = [], calls: { path: string; method: string; headers: Headers; body: Record<string, unknown> }[] = []
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(init?.redirect, 'error'); assert.ok(init?.signal)
    const path = new URL(String(url)).pathname, headers = new Headers(init?.headers)
    assert.equal(new URL(String(url)).origin, target.origin)
    assert.equal(headers.get('Origin'), target.origin)
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    calls.push({ path, method: init?.method ?? 'GET', headers, body })
    if (options.leak) throw new Error('PRIVATE RESPONSE TOKEN')
    if (path.endsWith('/site-config')) {
      if (!headers.has('x-attestrack-portal-secret') && !options.anonymousAllowed) return Response.json({ error: 'portal_unauthorized' }, { status: 401 })
      assert.equal(headers.get('x-attestrack-portal-secret'), fixture.portal_secret)
      return Response.json({ siteId: options.wrongSite ? 'unrelated' : target.site_id, consentConfigured: true, mode: 'ENFORCEMENT' })
    }
    if (path.endsWith('/consent/context')) return Response.json({ siteId: target.site_id })
    if (path.endsWith('/consent/commit')) { assert.equal(body.decision, 'granted'); return Response.json({ token: 'synthetic.token.signature' }) }
    if (path === '/t/event') {
      assert.equal(headers.get('Cookie'), 'at_consent=synthetic.token.signature')
      rows.push({ eventId: body.eventId, siteId: body.siteId, eventName: body.eventName, consentDecision: 'granted' })
      return Response.json({ ok: true, accepted: true }, { status: options.failEvent ? 500 : 200 })
    }
    assert.equal(path, '/__attestrack__/portal/v1/explore/query')
    assert.equal(headers.get('x-attestrack-portal-secret'), fixture.portal_secret)
    assert.match(body.sql, /^SELECT eventId, siteId, eventName, consentDecision FROM events WHERE siteId = 'dedicated-fixture' AND eventId IN \('[0-9a-f-]+'/)
    const found = options.missingOld ? [] : rows.filter(row => body.sql.includes(row.eventId))
    const result = options.duplicate && found.length ? [...found, found[0]] : found
    return Response.json({ columns: ['eventId', 'siteId', 'eventName', 'consentDecision'], rows: result, rowCount: result.length, truncated: options.truncated ?? false })
  }
  return { fetcher, calls, rows }
}
test('four observed phases retain every real synthetic forward row with one event each', async () => {
  const s = server(); let previous: Witness | undefined
  for (const phase of ['predecessor', 'candidate', 'recovery', 'resume'] as Phase[]) previous = await observe({ target, artifact, phase, mutation: mutation(previous?.cohort), previous }, fixture, s.fetcher)
  assert.equal(previous?.phases.length, 4)
  assert.equal(s.calls.filter(c => c.path === '/t/event').length, 4)
  assert.equal(s.rows.length, 4)
  const report = JSON.stringify(previous)
  for (const secret of [fixture.portal_secret, 'synthetic.token.signature']) assert.ok(!report.includes(secret))
  assert.deepEqual(Object.keys(previous!).sort(), ['artifact', 'cohort', 'observation', 'phases', 'schema', 'target_sha256'])
})
test('unconfigured source target refuses before any request', async () => {
  const s = server(); await assert.rejects(observe({ target: null, artifact, phase: 'predecessor', mutation: mutation() }, fixture, s.fetcher), /target_not_configured/); assert.equal(s.calls.length, 0)
})
for (const [name, option] of Object.entries({ 'anonymous portal allowed': { anonymousAllowed: true }, 'wrong native site': { wrongSite: true }, 'truncated warehouse': { truncated: true } })) {
  test(`${name} refuses before consent or event mutation`, async () => {
    const s = server(option); await assert.rejects(observe({ target, artifact, phase: 'predecessor', mutation: mutation() }, fixture, s.fetcher)); assert.equal(s.calls.filter(c => c.path.endsWith('/consent/commit') || c.path === '/t/event').length, 0)
  })
}
test('missing retained row refuses before next phase mutation', async () => {
  const s = server(); const previous = await observe({ target, artifact, phase: 'predecessor', mutation: mutation() }, fixture, s.fetcher)
  const broken = server({ missingOld: true }); await assert.rejects(observe({ target, artifact, phase: 'candidate', mutation: mutation(previous.cohort), previous }, fixture, broken.fetcher), /forward_rows_missing/)
  assert.ok(!broken.calls.some(c => c.path === '/t/event' || c.path.endsWith('/consent/commit')))
})
test('duplicate durable event rows fail rather than claim deduplication', async () => {
  const s = server({ duplicate: true }); await assert.rejects(observe({ target, artifact, phase: 'predecessor', mutation: mutation() }, fixture, s.fetcher), /warehouse/)
  assert.equal(s.calls.filter(c => c.path === '/t/event').length, 1)
})
test('ambiguous failed event response is never replayed', async () => {
  const s = server({ failEvent: true }); await assert.rejects(observe({ target, artifact, phase: 'predecessor', mutation: mutation() }, fixture, s.fetcher), /http_observation_failed/)
  assert.equal(s.calls.filter(c => c.path === '/t/event').length, 1)
})
test('phase jumping, changed artifact and malformed native numeric IDs refuse without requests', async () => {
  const s = server(); const previous = await observe({ target, artifact, phase: 'predecessor', mutation: mutation() }, fixture, s.fetcher)
  for (const input of [{ target, artifact, phase: 'recovery' as Phase, mutation: mutation(previous.cohort), previous }, { target, artifact: { ...artifact, artifact_id: 9 }, phase: 'candidate' as Phase, mutation: mutation(previous.cohort), previous }, { target, artifact: { ...artifact, producer_run: [2] as unknown as number }, phase: 'predecessor' as Phase, mutation: mutation() }]) {
    const broken = server(); await assert.rejects(observe(input, fixture, broken.fetcher)); assert.equal(broken.calls.length, 0)
  }
})
test('transport exceptions cannot expose raw private text', async () => {
  await assert.rejects(observe({ target, artifact, phase: 'predecessor', mutation: mutation() }, fixture, server({ leak: true }).fetcher), error => error instanceof Error && error.message === 'http_observation_failed')
})

test('tracked source profile remains explicitly unconfigured', () => {
  assert.equal(configuredTarget(), null)
})
test('oversized private response fails closed before any mutation', async () => {
  const s = server()
  const fetcher: typeof fetch = async (url, init) => {
    if (new Headers(init?.headers).has('x-attestrack-portal-secret')) return new Response('x'.repeat(65537))
    return s.fetcher(url, init)
  }
  await assert.rejects(observe({ target, artifact, phase: 'predecessor', mutation: mutation() }, fixture, fetcher), /http_observation_failed/)
  assert.ok(!s.calls.some(c => c.method === 'POST'))
})
test('wrong site, query injection and array-shaped hashes cannot become target scope', async () => {
  for (const bad of [{ ...target, site_id: "x' OR 1=1" }, { ...target, origin: 'http://fixture.invalid' }, { ...target, policy_hash: ['a'.repeat(64)] as unknown as string }]) {
    const s = server(); await assert.rejects(observe({ target: bad, artifact, phase: 'predecessor', mutation: mutation() }, fixture, s.fetcher)); assert.equal(s.calls.length, 0)
  }
})

test('accepted event with lost response reconciles the SAME durable identity without mutation replay', async () => {
  const s = server()
  // Factory-selected input survives failure; no success flag or generated replacement ID.
  const prepared: PreparedPhase = { target, artifact, phase: 'predecessor', mutation: mutation() }
  const persisted = JSON.stringify(prepared)
  const lost: typeof fetch = async (url, init) => {
    const response = await s.fetcher(url, init)
    if (new URL(String(url)).pathname === '/t/event') throw new Error('lost response after accepted write')
    return response
  }
  await assert.rejects(observe(prepared, fixture, lost), /http_observation_failed/)
  assert.equal(s.rows[0].eventId, prepared.mutation.event_id)
  const callCount = s.calls.length
  const recovered = await inspect(JSON.parse(persisted), fixture, s.fetcher)
  assert.equal(recovered.observation, 'read-only')
  assert.equal(recovered.cohort, prepared.mutation.cohort)
  assert.equal(recovered.phases[0].event_id, prepared.mutation.event_id)
  assert.ok(s.calls.slice(callCount).every(c => c.path !== '/t/event' && !c.path.endsWith('/consent/commit')))
  assert.equal(s.calls.filter(c => c.path === '/t/event').length, 1)
  await assert.rejects(observe(prepared, fixture, s.fetcher), /mutation_already_observed_use_inspect/)
  assert.equal(s.calls.filter(c => c.path === '/t/event').length, 1)
})
test('missing or incompatible durable mutation identities refuse before requests', async () => {
  const s = server(); const previous = await observe({ target, artifact, phase: 'predecessor', mutation: mutation() }, fixture, s.fetcher)
  for (const bad of [undefined, { cohort: previous.cohort, event_id: previous.phases[0].event_id }, mutation()]) {
    const broken = server()
    await assert.rejects(inspect({ target, artifact, phase: 'candidate', previous, mutation: bad } as PreparedPhase, fixture, broken.fetcher))
    assert.equal(broken.calls.length, 0)
  }
})
