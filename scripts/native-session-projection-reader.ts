/** Native original-job session proof. No journal key, writer or provider grant. */
import { readFileSync } from 'node:fs';
import { canonical } from './native-release-canonical.ts';
import type { Executor } from './native-application-operation.ts';
import type { GitHubRead } from './native-application-release.ts';
import { verifyCurrentPublicHead, verifyCurrentPublicJournal } from './native-journal-projection.ts';
import { ISSUER_PROFILE, ProjectionGitHubRead, readSessionIssuerArtifact, selectIssuer, validateIssuerBinding,
  type IssuerBinding, type ProjectionLocator, type SessionIssuerJob } from './native-journal-projection-reader.ts';
import { validateSessionProjection, validatePreviousWitness, type SessionContext, type SessionProjection, type SessionDescriptor, type WitnessPhase } from './native-release-session.ts';
import type { Witness } from './application-witness.ts';

export class NativeSessionProjectionReader {
  private readonly binding: IssuerBinding;
  private readonly original: ProjectionLocator;
  private readonly environment: SessionContext['environment'];
  private readonly phase: WitnessPhase;
  private readonly reader: GitHubRead;
  constructor(binding: IssuerBinding, environment: SessionContext['environment'], original: ProjectionLocator, phase: WitnessPhase, reader?: GitHubRead) {
    this.binding = validateIssuerBinding(binding, environment); this.original = structuredClone(original);
    this.environment = environment; this.phase = phase;
    if (!['predecessor', 'candidate', 'recovery', 'resume'].includes(phase)) throw Error('Unknown native session issuer phase');
    this.reader = reader ?? new ProjectionGitHubRead(this.binding, environment, this.original);
  }
  private proof(context: SessionContext) {
    if (context.environment !== this.environment) throw Error('Native session environment differs');
    const job: SessionIssuerJob = this.phase === 'predecessor' ? 'attestrack-native-session' : `attestrack-native-witness-${this.phase}`;
    const evidence = readSessionIssuerArtifact(this.binding, this.environment, this.original, job, this.reader);
    const projection = validateSessionProjection(evidence.document, context, this.binding.store);
    const expectedName = this.phase === 'predecessor' ? `attestrack-native-session-${context.deployment_id}-${this.original.run_attempt}`
      : `attestrack-native-witness-${projection.descriptor.release_id}-${this.phase}-${this.original.run_attempt}`;
    if (evidence.name !== expectedName || (projection.witness_claim !== null && projection.witness_claim.phase !== this.phase)) throw Error('Native session artifact/phase namespace differs');
    return { evidence, projection };
  }
  /** Authenticates immutable source selection only. This does not verify that its
   * publication head is still current and must never authorize a write. */
  readDescriptor(context: SessionContext): SessionProjection['descriptor'] {
    const { evidence, projection } = this.proof(context); evidence.assertCurrent();
    return structuredClone(projection.descriptor);
  }
  /** An HTTP write requires this fresh authenticated durable claim, then the
   * original witness-job process fence, then this same read again. */
  readCurrentWitness(context: SessionContext, descriptor: SessionDescriptor, own: Executor, previous: Witness | undefined): SessionProjection {
    const { evidence, projection } = this.proof(context), claim = projection.witness_claim;
    if (canonical(projection.descriptor) !== canonical(descriptor)) throw Error('Witness claim replaces immutable selected session');
    if (!claim || canonical(claim.executor) !== canonical(own)) throw Error('Original durable witness executor differs');
    validatePreviousWitness(projection.descriptor, claim, previous);
    verifyCurrentPublicJournal(this.reader, projection); evidence.assertCurrent(); verifyCurrentPublicHead(this.reader, projection);
    return structuredClone(projection);
  }
}
export function configuredSessionReader(environment: SessionContext['environment'], original: ProjectionLocator, phase: WitnessPhase): NativeSessionProjectionReader {
  const configuration: unknown = JSON.parse(readFileSync(new URL('../' + ISSUER_PROFILE, import.meta.url), 'utf8'));
  return new NativeSessionProjectionReader(selectIssuer(configuration, environment), environment, original, phase);
}
