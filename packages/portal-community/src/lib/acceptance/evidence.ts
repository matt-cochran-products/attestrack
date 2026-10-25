/**
 * Dashboard live-acceptance evidence contract (metadata only).
 *
 * A record of this shape is what an operator/supervisor assembles AFTER a real
 * staged or production run; this module only validates its structure and
 * internal consistency. A record that passes `validateAcceptanceEvidence` is a
 * *candidate* for review — this code never observes a deployment and never
 * claims live acceptance on its own (`liveAcceptanceClaimed` is always false).
 *
 * Rules enforced:
 * - one unique **fictional** marker (`ATK-FICTIONAL-<16+ lowercase alnum>`),
 *   echoed by the durable warehouse row AND the authenticated Explore response;
 * - a **separate** UI transport marker (must differ from the data marker);
 * - durable warehouse row evidence from a warehouse read-back — never an
 *   ingest `accepted`/200 response, a `/health` probe, or a fixture;
 * - authenticated same-origin Explore POST + HAR/response refs + screenshots;
 * - negative outcomes for consent decline, unknown site, unauthenticated
 *   Access, and direct-origin bypass, each with an observed status + ref;
 * - every observation inside one window of at most 60 seconds;
 * - exact source commit, artifact digest and runtime-config identity;
 * - no booleans-as-evidence, no unknown keys, no token/credential/PII-looking
 *   strings anywhere (refs and digests only — never raw bodies or headers);
 * - plain bounded JSON only: cyclic, over-deep or over-large input is rejected
 *   (as errors, not exceptions) before any other check.
 */

export const ACCEPTANCE_EVIDENCE_SCHEMA = 'attestrack.dashboard-acceptance/v1' as const
export const MAX_ACCEPTANCE_WINDOW_MS = 60_000
export const EXPLORE_QUERY_PATH = '/__attestrack__/portal/v1/explore/query' as const

/** Repository-relative artifact reference with a content digest. */
export interface ArtifactRef {
  /** Relative path inside the evidence bundle, e.g. `har/explore.har`. */
  ref: string
  sha256: string
  mediaType: 'application/json' | 'application/har+json' | 'image/png' | 'text/plain'
}

export interface AcceptanceIdentity {
  /** Full 40-hex git commit of the source that produced the artifact. */
  sourceCommit: string
  /** The deployed portal build (same artifact for staging and production). */
  portalArtifact: { name: string; sha256: string }
  /** The Worker bundle that served the portal API. */
  workerArtifact: { name: string; sha256: string }
  /** How the portal was pointed at the API — runtime meta, not a rebuild. */
  runtimeConfig: {
    mechanism: 'html-meta'
    metaName: 'attestrack-portal-api'
    metaContent: 'same-origin'
    /** Digest of the host HTML actually served (contains the meta). */
    hostHtmlSha256: string
  }
  environment: 'staging' | 'production'
  /** https origin the portal + same-origin API were served from. */
  portalOrigin: string
}

export interface WarehouseRowEvidence {
  source: 'warehouse-readback'
  table: 'events'
  /**
   * Identity of the durable row (no row payload), copied from the actual row the
   * read-back query returned — not from the ingest request. `eventId` is the
   * canonical `events.eventId` column: the client idempotency key, not a
   * warehouse-assigned id.
   */
  eventId: string
  /** The row's canonical `events.receivedAt` timestamp, as read back. */
  receivedAt: string
  /** When the read-back query observed the row. */
  observedAt: string
  /** Marker value as read back from the row. Must equal `marker.value`. */
  markerReadBack: string
  readbackRef: ArtifactRef
}

export interface ExploreResponseEvidence {
  method: 'POST'
  path: typeof EXPLORE_QUERY_PATH
  /** Must equal `identity.portalOrigin` (same-origin runtime config). */
  requestOrigin: string
  credentialsMode: 'include'
  authentication: 'cloudflare-access-session'
  status: 200
  rowCount: number
  /** Marker as found in the response body. Must equal `marker.value`. */
  markerInResponse: string
  responseSha256: string
  observedAt: string
  harRef: ArtifactRef
}

export interface ScreenshotEvidence {
  id: string
  shows: 'explore-result-with-marker' | 'shell-live-worker-chip' | 'ui-transport-marker'
  capturedAt: string
  image: ArtifactRef
}

export interface UiTransportEvidence {
  /** Distinct from the data marker; proves the UI (not curl) issued the request. */
  marker: string
  dataSourceLabel: 'Live worker'
  observedAt: string
  screenshotId: string
}

export interface NegativeOutcome {
  status: number
  observedAt: string
  ref: ArtifactRef
}

export interface NegativeOutcomes {
  /** Event sent with a declined consent token: not delivered to destinations. */
  consentDeclined: NegativeOutcome & { outcome: 'not-delivered' }
  /** Request for an unconfigured site id: rejected. */
  unknownSite: NegativeOutcome & { outcome: 'rejected' }
  /** Portal API without an Access session: denied or redirected to login. */
  accessUnauthenticated: NegativeOutcome & { outcome: 'denied' | 'redirected-to-access-login' }
  /** Direct Worker/origin hostname bypassing Access: denied. */
  directOrigin: NegativeOutcome & { outcome: 'denied' }
}

export interface DashboardAcceptanceEvidence {
  schema: typeof ACCEPTANCE_EVIDENCE_SCHEMA
  marker: { value: string; fictional: true }
  window: { startedAt: string; endedAt: string }
  identity: AcceptanceIdentity
  warehouseRow: WarehouseRowEvidence
  exploreResponse: ExploreResponseEvidence
  screenshots: ScreenshotEvidence[]
  uiTransport: UiTransportEvidence
  negatives: NegativeOutcomes
}

export type AcceptanceValidation =
  | {
      ok: true
      status: 'evidence-structurally-valid'
      /** Structural validation never constitutes live acceptance. */
      liveAcceptanceClaimed: false
      evidence: DashboardAcceptanceEvidence
    }
  | { ok: false; liveAcceptanceClaimed: false; errors: string[] }

// ---------------------------------------------------------------------------

const MARKER_RE = /^ATK-FICTIONAL-[a-z0-9]{16,64}$/
const UI_MARKER_RE = /^ATK-UI-[a-z0-9]{16,64}$/
const SHA256_RE = /^[a-f0-9]{64}$/
const COMMIT_RE = /^[a-f0-9]{40}$/
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const NAME_RE = /^[A-Za-z0-9@][A-Za-z0-9@._/-]{0,127}$/

/** Strings that indicate fixtures, stubs, or non-durable probes instead of real evidence. */
const NON_EVIDENCE_RE = /fixture|sample|stub|mock|fake|dummy|placeholder|health|accepted/i

/** Strings that look like credentials or personal data — never allowed in evidence metadata. */
const SECRET_OR_PII_PATTERNS: readonly [RegExp, string][] = [
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, 'JWT-like token'],
  [/\bbearer\s+\S/i, 'bearer credential'],
  [/cf_authorization|cf-access-(client-secret|client-id|jwt|token)/i, 'Cloudflare Access credential'],
  [/\b(secret|password|passwd|api[_-]?key|token)\s*[:=]/i, 'credential assignment'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'email address'],
  [/\bset-cookie\b|\bcookie\s*:/i, 'cookie header'],
]

type Obj = Record<string, unknown>

class Collector {
  readonly errors: string[] = []
  add(path: string, msg: string): void {
    this.errors.push(`${path}: ${msg}`)
  }
}

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function obj(c: Collector, v: unknown, path: string, keys: readonly string[]): Obj | null {
  if (!isObj(v)) {
    c.add(path, 'must be an object')
    return null
  }
  for (const k of Object.keys(v)) {
    if (!keys.includes(k)) c.add(`${path}.${k}`, 'unknown field (booleans/flags are not evidence)')
  }
  for (const k of keys) {
    if (!(k in v)) c.add(`${path}.${k}`, 'required')
  }
  return v
}

function str(c: Collector, v: unknown, path: string, re?: RegExp): string | null {
  if (typeof v !== 'string' || v === '') {
    c.add(path, 'must be a non-empty string')
    return null
  }
  if (re && !re.test(v)) {
    c.add(path, `does not match ${re}`)
    return null
  }
  return v
}

function lit<T extends string | number | boolean>(c: Collector, v: unknown, path: string, allowed: readonly T[]): void {
  if (!allowed.includes(v as T)) c.add(path, `must be one of ${JSON.stringify(allowed)}`)
}

function noFixture(c: Collector, v: string | null, path: string): void {
  if (v != null && NON_EVIDENCE_RE.test(v)) c.add(path, 'looks like fixture/stub/health/accepted data, not durable evidence')
}

function timestamp(c: Collector, v: unknown, path: string, times: Map<string, number>): void {
  const s = str(c, v, path, ISO_RE)
  if (s == null) return
  const t = Date.parse(s)
  if (Number.isNaN(t)) c.add(path, 'invalid timestamp')
  else times.set(path, t)
}

function artifactRef(c: Collector, v: unknown, path: string, mediaTypes: readonly ArtifactRef['mediaType'][]): void {
  const o = obj(c, v, path, ['ref', 'sha256', 'mediaType'])
  if (!o) return
  const ref = str(c, o.ref, `${path}.ref`, REF_RE)
  if (ref != null && ref.split('/').some((seg) => seg === '..' || seg === '.')) c.add(`${path}.ref`, 'path traversal')
  noFixture(c, ref, `${path}.ref`)
  str(c, o.sha256, `${path}.sha256`, SHA256_RE)
  lit(c, o.mediaType, `${path}.mediaType`, mediaTypes)
}

function namedDigest(c: Collector, v: unknown, path: string): void {
  const o = obj(c, v, path, ['name', 'sha256'])
  if (!o) return
  noFixture(c, str(c, o.name, `${path}.name`, NAME_RE), `${path}.name`)
  str(c, o.sha256, `${path}.sha256`, SHA256_RE)
}

/**
 * Structural bounds for the recursive secret scan. A valid record nests ~4
 * levels and holds well under 100 values, so these only reject hostile or
 * malformed input — they keep the scan from overflowing the stack or running
 * unbounded on cyclic or huge objects.
 */
export const MAX_EVIDENCE_DEPTH = 16
export const MAX_EVIDENCE_NODES = 2_000

interface ScanState {
  nodes: number
  /** Objects/arrays on the current path — a repeat is a cycle. */
  ancestors: Set<object>
}

/** Returns false (with an error recorded) when the input exceeds structural bounds or is cyclic. */
function scanForSecrets(c: Collector, v: unknown, path: string, depth: number, state: ScanState): boolean {
  if (++state.nodes > MAX_EVIDENCE_NODES) {
    c.add('$', `exceeds ${MAX_EVIDENCE_NODES} values — not an evidence record`)
    return false
  }
  if (typeof v === 'string') {
    for (const [re, label] of SECRET_OR_PII_PATTERNS) {
      if (re.test(v)) c.add(path, `contains ${label} — evidence must be metadata only`)
    }
    return true
  }
  if (typeof v !== 'object' || v === null) return true
  if (depth >= MAX_EVIDENCE_DEPTH) {
    c.add(path, `nested deeper than ${MAX_EVIDENCE_DEPTH} levels — not an evidence record`)
    return false
  }
  if (state.ancestors.has(v)) {
    c.add(path, 'cyclic reference — evidence must be plain JSON metadata')
    return false
  }
  state.ancestors.add(v)
  const entries: [string, unknown][] = Array.isArray(v)
    ? v.map((x, i): [string, unknown] => [`[${i}]`, x])
    : Object.entries(v).map(([k, x]): [string, unknown] => [`.${k}`, x])
  for (const [suffix, x] of entries) {
    if (!scanForSecrets(c, x, `${path}${suffix}`, depth + 1, state)) return false
  }
  state.ancestors.delete(v)
  return true
}

function strictOrigin(c: Collector, v: unknown, path: string): string | null {
  const s = str(c, v, path)
  if (s == null) return null
  let u: URL
  try {
    u = new URL(s)
  } catch {
    c.add(path, 'not an absolute URL')
    return null
  }
  if (u.protocol !== 'https:' || u.origin !== s) {
    c.add(path, 'must be an exact https origin (no path, query, hash, userinfo or trailing slash)')
    return null
  }
  return s
}

function negative(
  c: Collector,
  v: unknown,
  path: string,
  outcomes: readonly string[],
  statusOk: (s: number) => boolean,
  times: Map<string, number>,
): void {
  const o = obj(c, v, path, ['outcome', 'status', 'observedAt', 'ref'])
  if (!o) return
  lit(c, o.outcome, `${path}.outcome`, outcomes)
  if (typeof o.status !== 'number' || !Number.isInteger(o.status) || !statusOk(o.status)) {
    c.add(`${path}.status`, 'observed status does not demonstrate the negative outcome')
  }
  timestamp(c, o.observedAt, `${path}.observedAt`, times)
  artifactRef(c, o.ref, `${path}.ref`, ['application/json', 'application/har+json', 'text/plain'])
}

/** Validate an untrusted evidence record. Never throws. */
export function validateAcceptanceEvidence(input: unknown): AcceptanceValidation {
  const c = new Collector()
  const times = new Map<string, number>()

  const root = obj(c, input, '$', [
    'schema',
    'marker',
    'window',
    'identity',
    'warehouseRow',
    'exploreResponse',
    'screenshots',
    'uiTransport',
    'negatives',
  ])
  if (!root) return { ok: false, liveAcceptanceClaimed: false, errors: c.errors }

  // Bounded first: a cyclic, too-deep or too-large input is rejected before any
  // further traversal, so the validator stays total (returns, never throws).
  if (!scanForSecrets(c, root, '$', 0, { nodes: 0, ancestors: new Set() })) {
    return { ok: false, liveAcceptanceClaimed: false, errors: c.errors }
  }
  lit(c, root.schema, '$.schema', [ACCEPTANCE_EVIDENCE_SCHEMA])

  // Marker
  let markerValue: string | null = null
  const marker = obj(c, root.marker, '$.marker', ['value', 'fictional'])
  if (marker) {
    markerValue = str(c, marker.value, '$.marker.value', MARKER_RE)
    lit(c, marker.fictional, '$.marker.fictional', [true])
  }

  // Window
  const win = obj(c, root.window, '$.window', ['startedAt', 'endedAt'])
  const windowTimes = new Map<string, number>()
  if (win) {
    timestamp(c, win.startedAt, '$.window.startedAt', windowTimes)
    timestamp(c, win.endedAt, '$.window.endedAt', windowTimes)
  }
  const start = windowTimes.get('$.window.startedAt')
  const end = windowTimes.get('$.window.endedAt')
  if (start != null && end != null) {
    if (end < start) c.add('$.window', 'endedAt precedes startedAt')
    else if (end - start > MAX_ACCEPTANCE_WINDOW_MS) c.add('$.window', `exceeds ${MAX_ACCEPTANCE_WINDOW_MS / 1000}s`)
  }

  // Identity
  let portalOrigin: string | null = null
  const id = obj(c, root.identity, '$.identity', [
    'sourceCommit',
    'portalArtifact',
    'workerArtifact',
    'runtimeConfig',
    'environment',
    'portalOrigin',
  ])
  if (id) {
    const commit = str(c, id.sourceCommit, '$.identity.sourceCommit', COMMIT_RE)
    if (commit != null && /^0+$/.test(commit)) c.add('$.identity.sourceCommit', 'null commit')
    namedDigest(c, id.portalArtifact, '$.identity.portalArtifact')
    namedDigest(c, id.workerArtifact, '$.identity.workerArtifact')
    const rc = obj(c, id.runtimeConfig, '$.identity.runtimeConfig', [
      'mechanism',
      'metaName',
      'metaContent',
      'hostHtmlSha256',
    ])
    if (rc) {
      lit(c, rc.mechanism, '$.identity.runtimeConfig.mechanism', ['html-meta'])
      lit(c, rc.metaName, '$.identity.runtimeConfig.metaName', ['attestrack-portal-api'])
      lit(c, rc.metaContent, '$.identity.runtimeConfig.metaContent', ['same-origin'])
      str(c, rc.hostHtmlSha256, '$.identity.runtimeConfig.hostHtmlSha256', SHA256_RE)
    }
    lit(c, id.environment, '$.identity.environment', ['staging', 'production'])
    portalOrigin = strictOrigin(c, id.portalOrigin, '$.identity.portalOrigin')
    if (portalOrigin != null && /localhost|127\.0\.0\.1|\.local$|example\.(com|net|org)/i.test(portalOrigin)) {
      c.add('$.identity.portalOrigin', 'local/example origins are not a staged or production deployment')
    }
  }

  // Warehouse row
  const wr = obj(c, root.warehouseRow, '$.warehouseRow', [
    'source',
    'table',
    'eventId',
    'receivedAt',
    'observedAt',
    'markerReadBack',
    'readbackRef',
  ])
  if (wr) {
    lit(c, wr.source, '$.warehouseRow.source', ['warehouse-readback'])
    lit(c, wr.table, '$.warehouseRow.table', ['events'])
    noFixture(c, str(c, wr.eventId, '$.warehouseRow.eventId', ID_RE), '$.warehouseRow.eventId')
    timestamp(c, wr.receivedAt, '$.warehouseRow.receivedAt', times)
    timestamp(c, wr.observedAt, '$.warehouseRow.observedAt', times)
    const rb = str(c, wr.markerReadBack, '$.warehouseRow.markerReadBack')
    if (rb != null && markerValue != null && rb !== markerValue) {
      c.add('$.warehouseRow.markerReadBack', 'does not equal marker.value')
    }
    artifactRef(c, wr.readbackRef, '$.warehouseRow.readbackRef', ['application/json', 'text/plain'])
  }
  const received = times.get('$.warehouseRow.receivedAt')
  const wrObserved = times.get('$.warehouseRow.observedAt')
  if (received != null && wrObserved != null && wrObserved < received) {
    c.add('$.warehouseRow.observedAt', 'read back before the row was received')
  }

  // Explore response
  const ex = obj(c, root.exploreResponse, '$.exploreResponse', [
    'method',
    'path',
    'requestOrigin',
    'credentialsMode',
    'authentication',
    'status',
    'rowCount',
    'markerInResponse',
    'responseSha256',
    'observedAt',
    'harRef',
  ])
  if (ex) {
    lit(c, ex.method, '$.exploreResponse.method', ['POST'])
    lit(c, ex.path, '$.exploreResponse.path', [EXPLORE_QUERY_PATH])
    const ro = strictOrigin(c, ex.requestOrigin, '$.exploreResponse.requestOrigin')
    if (ro != null && portalOrigin != null && ro !== portalOrigin) {
      c.add('$.exploreResponse.requestOrigin', 'not the portal origin (same-origin runtime config required)')
    }
    lit(c, ex.credentialsMode, '$.exploreResponse.credentialsMode', ['include'])
    lit(c, ex.authentication, '$.exploreResponse.authentication', ['cloudflare-access-session'])
    lit(c, ex.status, '$.exploreResponse.status', [200])
    if (typeof ex.rowCount !== 'number' || !Number.isInteger(ex.rowCount) || ex.rowCount < 1) {
      c.add('$.exploreResponse.rowCount', 'must be an integer >= 1 (an empty 200 is not evidence)')
    }
    const mr = str(c, ex.markerInResponse, '$.exploreResponse.markerInResponse')
    if (mr != null && markerValue != null && mr !== markerValue) {
      c.add('$.exploreResponse.markerInResponse', 'does not equal marker.value')
    }
    str(c, ex.responseSha256, '$.exploreResponse.responseSha256', SHA256_RE)
    timestamp(c, ex.observedAt, '$.exploreResponse.observedAt', times)
    artifactRef(c, ex.harRef, '$.exploreResponse.harRef', ['application/har+json'])
  }

  // Screenshots
  const shotIds = new Set<string>()
  const shotKinds = new Set<string>()
  const screenshots: unknown = root.screenshots
  if (!Array.isArray(screenshots) || screenshots.length === 0) {
    c.add('$.screenshots', 'must be a non-empty array')
  } else {
    screenshots.forEach((s: unknown, i: number) => {
      const p = `$.screenshots[${i}]`
      const o = obj(c, s, p, ['id', 'shows', 'capturedAt', 'image'])
      if (!o) return
      const sid = str(c, o.id, `${p}.id`, ID_RE)
      if (sid != null) {
        if (shotIds.has(sid)) c.add(`${p}.id`, 'duplicate screenshot id')
        shotIds.add(sid)
      }
      lit(c, o.shows, `${p}.shows`, ['explore-result-with-marker', 'shell-live-worker-chip', 'ui-transport-marker'])
      if (typeof o.shows === 'string') shotKinds.add(o.shows)
      timestamp(c, o.capturedAt, `${p}.capturedAt`, times)
      artifactRef(c, o.image, `${p}.image`, ['image/png'])
    })
    if (!shotKinds.has('explore-result-with-marker')) {
      c.add('$.screenshots', 'missing an explore-result-with-marker screenshot')
    }
  }

  // UI transport marker
  const ui = obj(c, root.uiTransport, '$.uiTransport', ['marker', 'dataSourceLabel', 'observedAt', 'screenshotId'])
  if (ui) {
    const um = str(c, ui.marker, '$.uiTransport.marker', UI_MARKER_RE)
    if (um != null && markerValue != null && um.endsWith(markerValue.slice('ATK-FICTIONAL-'.length))) {
      c.add('$.uiTransport.marker', 'must be independent of the data marker')
    }
    lit(c, ui.dataSourceLabel, '$.uiTransport.dataSourceLabel', ['Live worker'])
    timestamp(c, ui.observedAt, '$.uiTransport.observedAt', times)
    const sid = str(c, ui.screenshotId, '$.uiTransport.screenshotId', ID_RE)
    if (sid != null && !shotIds.has(sid)) c.add('$.uiTransport.screenshotId', 'does not reference a listed screenshot')
  }

  // Negatives
  const neg = obj(c, root.negatives, '$.negatives', ['consentDeclined', 'unknownSite', 'accessUnauthenticated', 'directOrigin'])
  if (neg) {
    // Consent decline is proven by the delivery record, typically still a 2xx ingest.
    negative(c, neg.consentDeclined, '$.negatives.consentDeclined', ['not-delivered'], (s) => s >= 200 && s < 500, times)
    negative(c, neg.unknownSite, '$.negatives.unknownSite', ['rejected'], (s) => s >= 400 && s < 500, times)
    negative(
      c,
      neg.accessUnauthenticated,
      '$.negatives.accessUnauthenticated',
      ['denied', 'redirected-to-access-login'],
      (s) => s === 401 || s === 403 || s === 302 || s === 303,
      times,
    )
    negative(c, neg.directOrigin, '$.negatives.directOrigin', ['denied'], (s) => s === 401 || s === 403 || s === 404, times)
  }

  // Every observation must fall inside the bounded window.
  if (start != null && end != null && end >= start) {
    for (const [p, t] of times) {
      if (t < start || t > end) c.add(p, 'outside the acceptance window')
    }
  }

  if (c.errors.length > 0) return { ok: false, liveAcceptanceClaimed: false, errors: c.errors }
  return {
    ok: true,
    status: 'evidence-structurally-valid',
    liveAcceptanceClaimed: false,
    evidence: root as unknown as DashboardAcceptanceEvidence,
  }
}
