/** Closed public session data. Parsing never grants provider or witness effects. */
import { digest, REPOSITORY } from './application-artifacts.ts';
import { canonical } from './native-release-canonical.ts';
import { releasePhase, validateJournal, type Executor, type Phase } from './native-application-operation.ts';
import type { OriginalRun } from './native-application-coordinator.ts';
import type { ArtifactIdentity, Journal, Operation } from './native-application-release.ts';
import type { Witness } from './application-witness.ts';
import { validateStoreBinding, type ProjectionStore, type JournalStoreBinding } from './native-journal-projection.ts';

export type WitnessPhase = 'predecessor' | Phase;
export interface SessionDescriptor {
  schema: 'attestrack.native-release-session/v1'; release_id: string; environment: 'staging' | 'production';
  original_run: OriginalRun; admission_sha256: string; predecessor: ArtifactIdentity; candidate: ArtifactIdentity; recovery: ArtifactIdentity;
  target_sha256: string; tool_profile_sha256: string; http_target_sha256: string; persistence_contract_sha256: string;
  required_operations: Operation['name'][]; phase_operations: Record<Phase, string>;
  witness: { cohort: string; events: Record<WitnessPhase, string> };
}
export interface WitnessClaim {
  schema: 'attestrack.native-witness-claim/v1'; release_id: string; phase: WitnessPhase; cohort: string; event_id: string;
  executor: Executor; prior_witness_sha256: string | null; state: 'execution-claimed';
}
export interface SessionProjection {
  schema: 'attestrack.native-release-session-projection/v1'; repository: typeof REPOSITORY;
  environment: SessionDescriptor['environment']; deployment_id: number; selection_sha256: string;
  descriptor: SessionDescriptor; descriptor_sha256: string; witness_claim: WitnessClaim | null; store: ProjectionStore;
}
export interface SessionContext {
  environment: SessionDescriptor['environment']; deployment_id: number; selection_sha256: string;
  admission_sha256: string; original_run: OriginalRun;
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/, HASH = /^[a-f0-9]{64}$/, SHA = /^[a-f0-9]{40}$/;
const PHASES = ['candidate', 'recovery', 'resume'] as const;
const WITNESSES = ['predecessor', ...PHASES] as const;
const OPERATIONS = ['worker-upload', 'worker-switch', 'pages-assets', 'pages-deploy'] as const;
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
function closed(raw: unknown, keys: string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !equal(Object.keys(raw).sort(), keys.sort())) throw Error('Nonclosed native session data');
  return raw as Record<string, unknown>;
}
function identity(value: unknown, pattern: RegExp): void { if (typeof value !== 'string' || !pattern.test(value)) throw Error('Invalid native session identity'); }
function positive(value: unknown): void { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw Error('Invalid native session integer'); }
function original(raw: unknown, job = false): void {
  const e = closed(raw, ['repository_id', 'workflow_commit', 'run_id', 'run_attempt', ...(job ? ['job_id'] : [])]);
  for (const k of ['repository_id', 'run_id', 'run_attempt', ...(job ? ['job_id'] : [])]) positive(e[k]);
  identity(e.workflow_commit, SHA);
}
function artifact(raw: unknown): void {
  const a = closed(raw, ['artifact_id', 'producer_run', 'producer_attempt', 'archive_sha256', 'inventory_sha256', 'source_tree']);
  for (const k of ['artifact_id', 'producer_run', 'producer_attempt']) positive(a[k]);
  identity(a.archive_sha256, HASH); identity(a.inventory_sha256, HASH); identity(a.source_tree, SHA);
}
export function validateSessionDescriptor(raw: unknown): SessionDescriptor {
  const d = closed(raw, ['schema', 'release_id', 'environment', 'original_run', 'admission_sha256', 'predecessor', 'candidate', 'recovery',
    'target_sha256', 'tool_profile_sha256', 'http_target_sha256', 'persistence_contract_sha256', 'required_operations', 'phase_operations', 'witness']);
  if (d.schema !== 'attestrack.native-release-session/v1' || !['staging', 'production'].includes(d.environment as string)) throw Error('Invalid native session purpose');
  releasePhase({ release_id: d.release_id as string, phase: 'candidate' }); original(d.original_run);
  for (const k of ['admission_sha256', 'target_sha256', 'tool_profile_sha256', 'http_target_sha256', 'persistence_contract_sha256']) identity(d[k], HASH);
  for (const k of ['predecessor', 'candidate', 'recovery']) artifact(d[k]);
  if (!equal(d.required_operations, OPERATIONS) && !equal(d.required_operations, OPERATIONS.slice(0, 2))) throw Error('Invalid required native operation prefix');
  const ops = closed(d.phase_operations, [...PHASES]), w = closed(d.witness, ['cohort', 'events']), events = closed(w.events, [...WITNESSES]);
  identity(w.cohort, UUID);
  for (const id of [...Object.values(ops), ...Object.values(events)]) identity(id, UUID);
  const ids = [d.release_id, w.cohort, ...Object.values(ops), ...Object.values(events)];
  if (new Set(ids).size !== ids.length) throw Error('Release, operation, cohort and witness identities must be distinct');
  return structuredClone(raw) as SessionDescriptor;
}
export function phaseArtifact(descriptor: SessionDescriptor, phase: WitnessPhase): ArtifactIdentity {
  validateSessionDescriptor(descriptor);
  if (!WITNESSES.includes(phase)) throw Error('Unknown native phase');
  return structuredClone(phase === 'predecessor' ? descriptor.predecessor : phase === 'recovery' ? descriptor.recovery : descriptor.candidate);
}
export function validateWitnessClaim(raw: unknown, descriptor: SessionDescriptor): WitnessClaim {
  const c = closed(raw, ['schema', 'release_id', 'phase', 'cohort', 'event_id', 'executor', 'prior_witness_sha256', 'state']);
  if (c.schema !== 'attestrack.native-witness-claim/v1' || c.state !== 'execution-claimed' || c.release_id !== descriptor.release_id
      || !WITNESSES.includes(c.phase as WitnessPhase) || c.cohort !== descriptor.witness.cohort
      || c.event_id !== descriptor.witness.events[c.phase as WitnessPhase]) throw Error('Witness claim differs from immutable session');
  original(c.executor, true);
  const e = c.executor as Executor, run = { repository_id: e.repository_id, workflow_commit: e.workflow_commit, run_id: e.run_id, run_attempt: e.run_attempt };
  if (!equal(run, descriptor.original_run)) throw Error('Witness claim replaces original app run');
  if (c.phase === 'predecessor') { if (c.prior_witness_sha256 !== null) throw Error('Predecessor cannot claim an existing witness chain'); }
  else identity(c.prior_witness_sha256, HASH);
  return structuredClone(raw) as WitnessClaim;
}
/** Immutable original descriptor can support GET-only preparation after later
 * journal commits. Effect paths must separately authenticate the current head. */
export function validateSessionProjection(raw: unknown, context: SessionContext, binding: JournalStoreBinding): SessionProjection {
  const p = closed(raw, ['schema', 'repository', 'environment', 'deployment_id', 'selection_sha256', 'descriptor', 'descriptor_sha256', 'witness_claim', 'store']);
  positive(context.deployment_id); identity(context.selection_sha256, HASH); identity(context.admission_sha256, HASH); original(context.original_run);
  if (p.schema !== 'attestrack.native-release-session-projection/v1' || p.repository !== REPOSITORY || p.environment !== context.environment
      || p.deployment_id !== context.deployment_id || p.selection_sha256 !== context.selection_sha256) throw Error('Native session request differs');
  const d = validateSessionDescriptor(p.descriptor);
  if (d.environment !== context.environment || d.admission_sha256 !== context.admission_sha256 || !equal(d.original_run, context.original_run)
      || p.descriptor_sha256 !== digest(canonical(d))) throw Error('Native session admission or original executor differs');
  const s = closed(p.store, ['repository', 'repository_id', 'branch', 'genesis_head', 'head', 'ciphertext_sha256', 'signature_sha256']);
  if (!equal(validateStoreBinding({ repository: s.repository, repository_id: s.repository_id, branch: s.branch, genesis_head: s.genesis_head }, context.environment),
    validateStoreBinding(binding, context.environment))) throw Error('Native session journal authority differs');
  identity(s.head, SHA); identity(s.ciphertext_sha256, HASH); identity(s.signature_sha256, HASH);
  if (s.head === s.genesis_head) throw Error('Empty genesis cannot contain an admitted release session');
  if (p.witness_claim !== null) validateWitnessClaim(p.witness_claim, d);
  return structuredClone(raw) as SessionProjection;
}
/** The prepared journal is an observation, not new admission or a write grant. */
export function validatePhasePreparation(descriptor: SessionDescriptor, phase: Phase, journal: Journal): void {
  validateJournal(journal);
  const selected = phaseArtifact(descriptor, phase);
  if (!equal(journal.artifact, selected) || journal.operation_id !== descriptor.phase_operations[phase]
      || journal.target_sha256 !== descriptor.target_sha256 || journal.tool_profile_sha256 !== descriptor.tool_profile_sha256
      || journal.operations.length !== 1 || journal.operations[0].name !== 'worker-upload' || journal.operations[0].state !== 'unknown'
      || journal.operations[0].native_id !== null || journal.after !== null) throw Error('Native phase preparation differs from admitted session');
}
export function validatePreviousWitness(descriptor: SessionDescriptor, claim: WitnessClaim, previous: Witness | undefined): void {
  validateWitnessClaim(claim, descriptor);
  if (claim.phase === 'predecessor') { if (previous !== undefined) throw Error('Unexpected predecessor witness chain'); return; }
  if (previous) closed(previous, ['schema', 'observation', 'artifact', 'target_sha256', 'cohort', 'phases']);
  if (!previous || previous.schema !== 'attestrack.http-witness/v1' || !['write-and-read', 'read-only'].includes(previous.observation) || digest(canonical(previous)) !== claim.prior_witness_sha256 || !equal(previous.artifact, descriptor.candidate)
      || previous.cohort !== descriptor.witness.cohort || previous.target_sha256 !== descriptor.http_target_sha256) throw Error('Prior witness chain differs from durable claim');
  const earlier = WITNESSES.slice(0, WITNESSES.indexOf(claim.phase));
  if (!equal(previous.phases, earlier.map(phase => ({ phase, event_id: descriptor.witness.events[phase] })))) throw Error('Prior witness phase/events differ');
}
