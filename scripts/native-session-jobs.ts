/** Executable role cores over the existing native writer. Hosted custody and
 * fixed workflow assembly remain separate; no default token/target is invented. */
import { digest } from './application-artifacts.ts';
import { canonical } from './native-release-canonical.ts';
import { NativeWriter, targetIdentity, type Bundle, type NativeHTTP, type Snapshot, type Target } from './native-application-release.ts';
import type { PlannedRequest } from './application-release-scope.ts';
import type { Executor, ExecutionContext, Phase } from './native-application-operation.ts';
import { NativeJournalProjectionReader, consumeProjection } from './native-journal-projection-reader.ts';
import type { OriginalJobRuntime } from './native-application-job-fence.ts';
import { NativeIntakeReader, intakeContext } from './native-intake-reader.ts';
import type { HashRuntime } from './native-release-tool.ts';
import { phaseArtifact, validatePhasePreparation, validateSessionDescriptor, type SessionDescriptor, type WitnessPhase } from './native-release-session.ts';

const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
function original(own: Executor) { return { repository_id: own.repository_id, workflow_commit: own.workflow_commit, run_id: own.run_id, run_attempt: own.run_attempt }; }
function targetBinding(target: Target, descriptor: SessionDescriptor): void {
  validateSessionDescriptor(descriptor);
  if (target.environment !== descriptor.environment || targetIdentity(target) !== descriptor.target_sha256
      || descriptor.required_operations.length !== (target.pages === null ? 2 : 4)) throw Error('Native target differs from selected session');
}
/** Only GET reaches this adapter, including observations made while preparing or
 * after a witness. The surrounding trusted job may hold its existing provider
 * credential, but this role has no reachable write method. */
export function readOnlyNative(http: NativeHTTP): NativeHTTP {
  return { ...(http.page ? { page: (path: string) => http.page!(path) } : {}), async request(path, init, bearer) {
    if (init?.method && init.method !== 'GET') throw Error('Native observation role refuses writes');
    if (init?.body != null || bearer !== undefined) throw Error('Native observation role refuses payload/token override');
    return http.request(path, init);
  } };
}
export async function observePredecessor(plan: PlannedRequest, own: Executor, target: Target, http: NativeHTTP, intake: NativeIntakeReader, deploymentId: number) {
  if (!same(original(own), plan.context) || plan.targets.native_sha256 !== targetIdentity(target)
      || target.environment !== (plan.branch === 'staging' ? 'staging' : 'production')) throw Error('Predecessor observation differs from original admission');
  if (!(intake instanceof NativeIntakeReader)) throw Error('Authenticated queue intake reader required');
  const admitted = intake.read(intakeContext(plan, deploymentId));
  const snapshot = await new NativeWriter(target, readOnlyNative(http)).observe();
  admitted.assertControllerActive();
  return { schema: 'attestrack.native-predecessor-observation/v1' as const, admission_sha256: digest(canonical(plan)), controller: admitted.receipt.controller, deployment_id: deploymentId, executor: structuredClone(own), snapshot };
}
export async function preparePhase(descriptor: SessionDescriptor, phase: Phase, bundle: Bundle, target: Target, http: NativeHTTP) {
  targetBinding(target, descriptor);
  if (!same(bundle.identity, phaseArtifact(descriptor, phase))) throw Error('Prepared artifact differs from selected phase');
  const writer = new NativeWriter(target, readOnlyNative(http));
  const predecessor = await writer.observe(), journal = writer.prepareOperation(bundle, predecessor, descriptor.phase_operations[phase]);
  validatePhasePreparation(descriptor, phase, journal); return journal;
}
export async function readbackPhase(descriptor: SessionDescriptor, phase: WitnessPhase, own: Executor, target: Target, http: NativeHTTP) {
  targetBinding(target, descriptor);
  if (!same(original(own), descriptor.original_run)) throw Error('Readback original app run differs');
  const snapshot: Snapshot = await new NativeWriter(target, readOnlyNative(http)).observe();
  return { schema: 'attestrack.native-phase-readback/v1' as const, release_id: descriptor.release_id, phase,
    artifact: phaseArtifact(descriptor, phase), executor: structuredClone(own), snapshot };
}
/** One process must retain this call from fence through provider execution.
 * Candidate code is never evaluated; Bundle and tool were admitted by existing
 * original native artifact readers. acquireProvider runs strictly after the
 * authenticated original-job fence and current-head bookend. */
export async function executePhaseOperation(descriptor: SessionDescriptor, context: ExecutionContext, own: Executor, bundle: Bundle,
  tool: HashRuntime, target: Target, reader: NativeJournalProjectionReader, acquireProvider: () => Promise<NativeHTTP>, runtime?: OriginalJobRuntime) {
  targetBinding(target, descriptor);
  if (context.release_id !== descriptor.release_id || context.environment !== descriptor.environment
      || context.operation_id !== descriptor.phase_operations[context.phase] || !same(original(own), descriptor.original_run)
      || !same(bundle.identity, phaseArtifact(descriptor, context.phase))) throw Error('Provider operation differs from immutable selected phase');
  const frame = await reader.readCurrent({ repository: 'matt-cochran-products/attestrack', ...context });
  // Reconstruct the exact next operation with the original admitted Bundle
  // before the fence or provider credential acquisition. This also rejects
  // forged/cloned Bundle objects through NativeWriter's existing admission map.
  const prior = frame.journal.operations.length === 1 ? null : structuredClone(frame.journal);
  if (prior) prior.operations.pop();
  const planner = new NativeWriter(target, { async request() { throw Error('Journal planning cannot call a provider'); } });
  const expected = planner.prepareOperation(bundle, frame.journal.predecessor, context.operation_id, prior);
  if (!same(expected, frame.journal)) throw Error('Claimed provider journal differs from original retained bytes');
  const selectedTarget = structuredClone(target);
  const execution = await consumeProjection(reader, context, own, runtime);
  const provider = await acquireProvider();
  return new NativeWriter(selectedTarget, provider).executeOperation(bundle, tool, execution);
}
