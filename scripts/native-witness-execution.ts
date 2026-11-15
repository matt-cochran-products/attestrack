/** Fixture-only execution after durable claim, original job fence and bookend. */
import { canonical } from './native-release-canonical.ts';
import { NativeGitHub } from './native-application-release.ts';
import { reserveOriginalWitness, type OriginalJobRuntime } from './native-application-job-fence.ts';
import type { Executor } from './native-application-operation.ts';
import { NativeSessionProjectionReader } from './native-session-projection-reader.ts';
import { observe, targetIdentity, type Fixture, type Target, type Witness } from './application-witness.ts';
import type { SessionContext, SessionDescriptor, SessionProjection, WitnessPhase } from './native-release-session.ts';

export interface WitnessExecution { readonly release_id: string; readonly phase: WitnessPhase }
const grants = new WeakMap<WitnessExecution, { projection: SessionProjection; previous: Witness | undefined }>();
/** No fixture/provider/key acquisition occurs here. The actual trusted reader
 * authenticates durable intent; WeakMap only prevents local grant reuse. */
export function witnessExecution(reader: NativeSessionProjectionReader, context: SessionContext, descriptor: SessionDescriptor, own: Executor, previous?: Witness,
  runtime: OriginalJobRuntime = { github: new NativeGitHub(), env: process.env }): WitnessExecution {
  if (!(reader instanceof NativeSessionProjectionReader)) throw Error('Native session projection verifier required');
  const projection = reader.readCurrentWitness(context, descriptor, own, previous), claim = projection.witness_claim!;
  reserveOriginalWitness(claim, context.environment, projection.descriptor_sha256, runtime);
  if (canonical(reader.readCurrentWitness(context, descriptor, own, previous)) !== canonical(projection)) throw Error('Witness claim changed while consuming original job fence');
  const cap = Object.freeze({ release_id: claim.release_id, phase: claim.phase });
  grants.set(cap, { projection, previous: structuredClone(previous) }); return cap;
}
/** The fixed CLI supplies its lazy fixture loader only after obtaining the
 * capability. Throws preserve both durable claim and local marker; no reissue. */
export async function executeWitness(capability: WitnessExecution, target: Target, acquireFixture: () => Promise<Fixture>, fetcher: typeof fetch = fetch): Promise<Witness> {
  const grant = grants.get(capability);
  if (!grant) throw Error('Original durable witness execution capability required');
  grants.delete(capability);
  const { descriptor, witness_claim: claim } = grant.projection;
  if (targetIdentity(target) !== descriptor.http_target_sha256) throw Error('Witness target differs from admitted session');
  const selectedTarget = structuredClone(target);
  const fixture = await acquireFixture();
  return observe({ target: selectedTarget, artifact: descriptor.candidate, phase: claim!.phase,
    mutation: { cohort: claim!.cohort, event_id: claim!.event_id }, previous: grant.previous }, fixture, fetcher);
}
