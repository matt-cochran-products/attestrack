/** Authenticate queue admission before even the first GET-only P observation. */
import { digest, REPOSITORY } from './application-artifacts.ts';
import { canonical } from './native-release-canonical.ts';
import type { PlannedRequest } from './application-release-scope.ts';
import type { OriginalRun } from './native-application-coordinator.ts';
import type { GitHubRead } from './native-application-release.ts';
import { INFRA_ID } from './native-journal-projection.ts';
import { ProjectionGitHubRead, readSessionIssuerArtifact, validateIssuerBinding, type IssuerBinding, type ProjectionLocator } from './native-journal-projection-reader.ts';
import type { SessionContext } from './native-release-session.ts';
export interface NativeIntake {
  schema: 'attestrack.native-release-intake/v1'; deployment_id: number; environment: 'staging' | 'production';
  selection_sha256: string; admission_sha256: string; original_run: OriginalRun; controller: OriginalRun;
}
export function intakeContext(plan: PlannedRequest, deploymentId: number): SessionContext {
  if (plan.schema !== 'attestrack.application-source-admission/v1' || plan.kind !== 'planned' || plan.repository !== REPOSITORY
      || !['staging', 'main'].includes(plan.branch) || !Number.isSafeInteger(deploymentId) || deploymentId < 1) throw Error('Original native source request required');
  const selected = { repository: plan.repository, repository_id: plan.repository_id, branch: plan.branch, source_commit: plan.source_commit,
    source_tree: plan.source_tree, artifact: plan.artifact, targets: plan.targets, tool: plan.tool };
  return { environment: plan.branch === 'staging' ? 'staging' : 'production', deployment_id: deploymentId,
    selection_sha256: digest(canonical(selected)), admission_sha256: digest(canonical(plan)), original_run: structuredClone(plan.context) };
}
export class NativeIntakeReader {
  private readonly binding: IssuerBinding;
  private readonly original: ProjectionLocator;
  private readonly environment: SessionContext['environment'];
  private readonly reader: GitHubRead;
  constructor(binding: IssuerBinding, environment: SessionContext['environment'], original: ProjectionLocator, reader?: GitHubRead) {
    this.binding = validateIssuerBinding(binding, environment); this.original = structuredClone(original); this.environment = environment;
    this.reader = reader ?? new ProjectionGitHubRead(this.binding, environment, this.original);
  }
  read(context: SessionContext): { receipt: NativeIntake; assertControllerActive: () => void } {
    if (context.environment !== this.environment) throw Error('Intake environment differs');
    const proof = readSessionIssuerArtifact(this.binding, this.environment, this.original, 'scope', this.reader, 'intake.json');
    const expected: NativeIntake = { schema: 'attestrack.native-release-intake/v1', ...context,
      controller: { repository_id: INFRA_ID, workflow_commit: this.original.source_commit, run_id: this.original.run_id, run_attempt: this.original.run_attempt } };
    if (canonical(proof.document) !== canonical(expected) || proof.name !== `attestrack-native-intake-${context.deployment_id}-${this.original.run_attempt}`) throw Error('Original queue intake differs from exact request/controller');
    proof.assertControllerActive(); return { receipt: structuredClone(expected), assertControllerActive: proof.assertControllerActive };
  }
}
