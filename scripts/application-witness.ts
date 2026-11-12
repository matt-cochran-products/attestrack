/** HTTP/warehouse observations only. Never a native deployment or spend grant. */
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

const phases = ['predecessor', 'candidate', 'recovery', 'resume'] as const
export type Phase = typeof phases[number]
export type Target = { origin: string; site_id: string; policy_hash: string }
export type Artifact = { artifact_id: number; producer_run: number; producer_attempt: number; archive_sha256: string; inventory_sha256: string; source_tree: string }
export type Fixture = { portal_secret: string; access?: { client_id: string; client_secret: string } }
export type Witness = { schema: 'attestrack.http-witness/v1'; artifact: Artifact; target_sha256: string; cohort: string; phases: { phase: Phase; event_id: string }[] }
const hex = /^[0-9a-f]{64}$/
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
function requireThat(value: unknown, category: string): asserts value { if (!value) throw new Error(category) }
function object(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value), 'invalid_shape')
  requireThat(Object.keys(value).sort().join() === keys.sort().join(), 'invalid_shape')
}
export function targetIdentity(target: Target): string {
  object(target, ['origin', 'site_id', 'policy_hash'])
  const u = new URL(target.origin)
  requireThat(u.protocol === 'https:' && u.origin === target.origin && !u.username && !u.password && !u.port
    && !/^(localhost|127\.|\[|0\.)/.test(u.hostname), 'invalid_target')
  requireThat(typeof target.site_id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(target.site_id)
    && typeof target.policy_hash === 'string' && hex.test(target.policy_hash), 'invalid_target')
  return createHash('sha256').update(JSON.stringify([target.origin, target.site_id, target.policy_hash])).digest('hex')
}
/** Fixed tracked configuration, not a fixture-selected host or an authorization receipt. */
export function configuredTarget(): Target | null {
  const profile: unknown = JSON.parse(readFileSync(new URL('../release/application-targets.json', import.meta.url), 'utf8'))
  object(profile, ['schema', 'staging'])
  requireThat(profile.schema === 'attestrack.application-targets/v1', 'invalid_target_profile')
  if (profile.staging === null) return null
  targetIdentity(profile.staging as Target)
  return profile.staging as Target
}
function artifactIdentity(a: Artifact): string {
  object(a, ['artifact_id', 'producer_run', 'producer_attempt', 'archive_sha256', 'inventory_sha256', 'source_tree'])
  for (const n of [a.artifact_id, a.producer_run, a.producer_attempt]) requireThat(Number.isSafeInteger(n) && n > 0, 'invalid_artifact_reference')
  for (const h of [a.archive_sha256, a.inventory_sha256]) requireThat(typeof h === 'string' && hex.test(h), 'invalid_artifact_reference')
  requireThat(typeof a.source_tree === 'string' && /^[0-9a-f]{40}$/.test(a.source_tree), 'invalid_artifact_reference')
  return JSON.stringify([a.artifact_id, a.producer_run, a.producer_attempt, a.archive_sha256, a.inventory_sha256, a.source_tree])
}
/** Caller must select the source-reviewed profile, authenticate original artifacts and
 * independently qualify native target/outbound authority BEFORE calling this function.
 * fetch injection is solely a source-test seam; there is deliberately no live CLI. */
export async function observe(input: { target: Target | null; artifact: Artifact; phase: Phase; previous?: Witness }, fixture: Fixture,
  fetcher: typeof fetch = fetch): Promise<Witness> {
  requireThat(input.target !== null, 'target_not_configured')
  const target = input.target, targetHash = targetIdentity(target), artifact = artifactIdentity(input.artifact)
  const index = phases.indexOf(input.phase)
  requireThat(index >= 0, 'invalid_phase')
  const prior = input.previous
  if (index === 0) requireThat(prior === undefined, 'invalid_chain')
  else {
    object(prior, ['schema', 'artifact', 'target_sha256', 'cohort', 'phases'])
    requireThat(prior.schema === 'attestrack.http-witness/v1' && artifactIdentity(prior.artifact) === artifact
      && prior.target_sha256 === targetHash && typeof prior.cohort === 'string' && uuid.test(prior.cohort)
      && Array.isArray(prior.phases) && prior.phases.length === index, 'invalid_chain')
    prior.phases.forEach((p, i) => { object(p, ['phase', 'event_id']); requireThat(p.phase === phases[i] && typeof p.event_id === 'string' && uuid.test(p.event_id), 'invalid_chain') })
    requireThat(new Set(prior.phases.map(p => p.event_id)).size === index, 'invalid_chain')
  }
  object(fixture, fixture.access === undefined ? ['portal_secret'] : ['portal_secret', 'access'])
  requireThat(typeof fixture.portal_secret === 'string' && fixture.portal_secret.length >= 24 && fixture.portal_secret.length <= 4096 && !/[\r\n]/.test(fixture.portal_secret), 'invalid_fixture')
  const access: Record<string, string> = {}
  if (fixture.access) {
    object(fixture.access, ['client_id', 'client_secret'])
    for (const s of Object.values(fixture.access)) requireThat(typeof s === 'string' && s.length > 0 && s.length <= 4096 && !/[\r\n]/.test(s), 'invalid_fixture')
    access['CF-Access-Client-Id'] = fixture.access.client_id; access['CF-Access-Client-Secret'] = fixture.access.client_secret
  }
  async function request(path: string, body?: unknown, portal = false, cookie?: string, expected = 200): Promise<Record<string, unknown>> {
    try {
      const response = await fetcher(target.origin + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { ...access, Origin: target.origin, ...(portal ? { 'x-attestrack-portal-secret': fixture.portal_secret } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      requireThat(response.status === expected, 'http_status_refused')
      // Bound even chunked bodies; never include private response text in errors.
      const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0
      if (reader) try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; requireThat(size <= 65536, 'response_too_large'); chunks.push(part.value) } } finally { await reader.cancel() }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      requireThat(value !== null && typeof value === 'object' && !Array.isArray(value), 'invalid_response')
      return value as Record<string, unknown>
    } catch { throw new Error('http_observation_failed') }
  }
  const sitePath = '/__attestrack__/portal/v1/site-config'
  const denied = await request(sitePath, undefined, false, undefined, 401)
  requireThat(denied.error === 'portal_unauthorized', 'portal_gate_not_observed')
  const site = await request(sitePath, undefined, true)
  requireThat(site.siteId === target.site_id && site.consentConfigured === true && (site.mode === 'SHADOW' || site.mode === 'ENFORCEMENT'), 'site_binding_failed')
  const context = await request('/__attestrack__/consent/context')
  requireThat(context.siteId === target.site_id, 'consent_context_failed')
  const cohort = prior?.cohort ?? randomUUID(), event = randomUUID()
  const chain = [...(prior?.phases ?? []), { phase: input.phase, event_id: event }]
  async function rows(ids: string[]): Promise<string[]> {
    const list = ids.length ? ids : [event]
    const sql = `SELECT eventId, siteId, eventName, consentDecision FROM events WHERE siteId = '${target.site_id}' AND eventId IN (${list.map(id => `'${id}'`).join(',')}) LIMIT 5`
    const result = await request('/__attestrack__/portal/v1/explore/query', { sql }, true)
    requireThat(JSON.stringify(result.columns) === JSON.stringify(['eventId', 'siteId', 'eventName', 'consentDecision'])
      && result.truncated === false && Array.isArray(result.rows) && result.rows.length <= 4 && result.rowCount === result.rows.length, 'warehouse_shape_failed')
    const found: string[] = []
    for (const row of result.rows) {
      object(row, ['eventId', 'siteId', 'eventName', 'consentDecision'])
      requireThat(typeof row.eventId === 'string' && list.includes(row.eventId) && !found.includes(row.eventId)
        && row.siteId === target.site_id && row.eventName === 'release_witness' && row.consentDecision === 'granted', 'warehouse_binding_failed')
      found.push(row.eventId)
    }
    return found
  }
  const old = chain.slice(0, -1).map(p => p.event_id)
  const before = await rows(old)
  requireThat(before.length === old.length && old.every(id => before.includes(id)), 'forward_rows_missing_before_write')
  const consent = await request('/__attestrack__/consent/commit', { siteId: target.site_id, decision: 'granted', policyHash: target.policy_hash })
  requireThat(typeof consent.token === 'string' && /^[A-Za-z0-9_.-]{1,8192}$/.test(consent.token), 'consent_token_failed')
  const accepted = await request('/t/event', { v: 1, siteId: target.site_id, eventName: 'release_witness', eventId: event,
    sessionId: cohort, occurredAt: new Date().toISOString(), pagePath: '/release-witness' }, false, `at_consent=${consent.token}`)
  requireThat(accepted.ok === true && accepted.accepted === true, 'event_not_accepted')
  const ids = chain.map(p => p.event_id)
  for (let attempt = 0; attempt < 5; attempt++) {
    const found = await rows(ids)
    if (found.length === ids.length && ids.every(id => found.includes(id))) return { schema: 'attestrack.http-witness/v1', artifact: input.artifact, target_sha256: targetHash, cohort, phases: chain }
    if (attempt < 4) await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error('forward_rows_not_observed')
}
