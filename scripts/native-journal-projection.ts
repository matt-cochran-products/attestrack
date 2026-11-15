/** Read-only public journal projection. Never decrypts or writes the store. */
import { createHash } from 'node:crypto';
import { canonical } from './native-release-canonical.ts';
import { digest, REPOSITORY } from './application-artifacts.ts';
import { claimOperation, prepareOperation, type Frame } from './native-application-operation.ts';
import type { GitHubRead } from './native-application-release.ts';

export const INFRA = 'matt-cochran-products/infra';
export const INFRA_ID = 1326961741;
/** Existing protected infra authority / journal_crypto.py at 86597fd. These are
 * public repository identities, not deployed grants or a genesis assertion. */
export const JOURNAL_STORES = Object.freeze({
  staging: Object.freeze({ repository: 'matt-cochran-products/platform-manifests-staging', repository_id: 1445127324 }),
  production: Object.freeze({ repository: 'matt-cochran-products/platform-manifests', repository_id: 1444967543 }),
});
export interface JournalStoreBinding {
  repository: string; repository_id: number; branch: 'release-ledger'; genesis_head: string;
}
export interface ProjectionStore extends JournalStoreBinding { head: string; ciphertext_sha256: string; signature_sha256: string }
export interface JournalProjection {
  schema: 'attestrack.native-operation-projection/v1'; repository: typeof REPOSITORY;
  environment: Frame['environment']; store: ProjectionStore; frame: Frame; frame_sha256: string;
}
const SHA = /^[a-f0-9]{40}$/, HASH = /^[a-f0-9]{64}$/;
function closed(raw: unknown, keys: string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || canonical(Object.keys(raw).sort()) !== canonical(keys.sort())) throw Error('Nonclosed journal projection');
  return raw as Record<string, unknown>;
}
function sha(raw: unknown): string { if (typeof raw !== 'string' || !SHA.test(raw)) throw Error('Invalid journal Git identity'); return raw; }
function hash(raw: unknown): string { if (typeof raw !== 'string' || !HASH.test(raw)) throw Error('Invalid journal digest'); return raw; }
export function validateStoreBinding(raw: unknown, environment: Frame['environment']): JournalStoreBinding {
  const s = closed(raw, ['repository', 'repository_id', 'branch', 'genesis_head']);
  const expected = JOURNAL_STORES[environment];
  if (!expected || s.repository !== expected.repository || s.repository_id !== expected.repository_id || s.branch !== 'release-ledger') throw Error('Unreviewed public journal store identity');
  sha(s.genesis_head); return structuredClone(raw) as JournalStoreBinding;
}
export function validateProjection(raw: unknown, context: { repository: typeof REPOSITORY; environment: Frame['environment']; operation_id: string }, binding: JournalStoreBinding): JournalProjection {
  const p = closed(raw, ['schema', 'repository', 'environment', 'store', 'frame', 'frame_sha256']);
  if (p.schema !== 'attestrack.native-operation-projection/v1' || p.repository !== REPOSITORY || context.repository !== REPOSITORY || p.environment !== context.environment) throw Error('Journal projection purpose/environment differs');
  const s = closed(p.store, ['repository', 'repository_id', 'branch', 'genesis_head', 'head', 'ciphertext_sha256', 'signature_sha256']);
  const actual = validateStoreBinding({ repository: s.repository, repository_id: s.repository_id, branch: s.branch, genesis_head: s.genesis_head }, context.environment);
  if (canonical(actual) !== canonical(validateStoreBinding(binding, context.environment))) throw Error('Journal projection configured genesis/store differs');
  sha(s.head); hash(s.ciphertext_sha256); hash(s.signature_sha256);
  if (s.head === s.genesis_head) throw Error('Empty genesis cannot authorize an execution claim');
  const f = p.frame as Frame;
  if (!f || f.environment !== context.environment || f.journal.operation_id !== context.operation_id || !f.executor
      || canonical(f) !== canonical(claimOperation(prepareOperation(f.journal, context.environment), f.executor))) throw Error('Projection is not an exact original execution claim');
  if (hash(p.frame_sha256) !== digest(canonical(f))) throw Error('Projection full frame digest differs');
  return structuredClone(raw) as JournalProjection;
}
export function projectionArtifactName(frame: Frame): string {
  if (!frame.executor) throw Error('Claimed provider executor required');
  return `attestrack-native-claim-${frame.journal.operation_id}-${frame.journal.operations.at(-1)!.name}-${frame.executor.job_id}-${frame.executor.run_attempt}`;
}
function publicHead(reader: GitHubRead, store: JournalStoreBinding): string {
  const prefix = `repos/${store.repository}`;
  const repository = reader.json<{ full_name: string; id: number; fork: boolean; private: boolean }>(prefix);
  if (repository.full_name !== store.repository || repository.id !== store.repository_id || repository.fork !== false || repository.private !== false) throw Error('Public journal repository identity differs');
  const ref = reader.json<{ ref: string; object: { type: string; sha: string } }>(`${prefix}/git/ref/heads/${store.branch}`);
  if (ref.ref !== `refs/heads/${store.branch}` || ref.object?.type !== 'commit') throw Error('Public journal branch differs');
  return sha(ref.object.sha);
}
export function verifyCurrentPublicHead(reader: GitHubRead, projection: JournalProjection): void {
  if (publicHead(reader, projection.store) !== projection.store.head) throw Error('Journal projection is not the current branch head');
}
function blob(reader: GitHubRead, repository: string, identity: string, size: number, limit: number): Buffer {
  sha(identity);
  if (!Number.isSafeInteger(size) || size < 1 || size > limit) throw Error('Public journal blob exceeds bound');
  const value = reader.json<{ sha: string; size: number; encoding: string; content: string }>(`repos/${repository}/git/blobs/${identity}`);
  if (value.sha !== identity || value.size !== size || value.encoding !== 'base64' || typeof value.content !== 'string' || value.content.length > Math.ceil(limit * 1.4) + 65536) throw Error('Public journal blob metadata differs');
  const encoded = value.content.replace(/\n/g, ''), bytes = Buffer.from(encoded, 'base64');
  if (bytes.length !== size || bytes.toString('base64') !== encoded || createHash('sha1').update(`blob ${size}\0`).update(bytes).digest('hex') !== identity) throw Error('Public journal native blob identity differs');
  return bytes;
}
/** Real ref/tree/blob reads bookend a byte-identical committed ciphertext. The
 * journal role independently verifies signature/decryption/ancestry before
 * publishing its authenticated projection; provider receives no private key.
 */
export function verifyCurrentPublicJournal(reader: GitHubRead, projection: JournalProjection): void {
  const s = projection.store, prefix = `repos/${s.repository}`;
  validateStoreBinding({ repository: s.repository, repository_id: s.repository_id, branch: s.branch, genesis_head: s.genesis_head }, projection.environment);
  if (publicHead(reader, s) !== s.head) throw Error('Journal projection is not the current branch head');
  const commit = reader.json<{ sha: string; tree: { sha: string } }>(`${prefix}/git/commits/${s.head}`);
  if (commit.sha !== s.head) throw Error('Public journal commit differs');
  const treeId = sha(commit.tree?.sha);
  const tree = reader.json<{ sha: string; truncated: boolean; tree: { path: string; mode: string; type: string; sha: string; size: number }[] }>(`${prefix}/git/trees/${treeId}`);
  if (tree.sha !== treeId || tree.truncated !== false || !Array.isArray(tree.tree) || tree.tree.length !== 2
      || canonical(tree.tree.map(e => e.path).sort()) !== canonical(['ledger.age', 'ledger.age.sig'])
      || tree.tree.some(e => e.mode !== '100644' || e.type !== 'blob')) throw Error('Public journal complete tree differs');
  const treeBytes = Buffer.concat([...tree.tree].sort((a, b) => a.path.localeCompare(b.path)).flatMap(entry =>
    [Buffer.from(`100644 ${entry.path}\0`), Buffer.from(sha(entry.sha), 'hex')]));
  if (createHash('sha1').update(`tree ${treeBytes.length}\0`).update(treeBytes).digest('hex') !== treeId) throw Error('Public journal native Git tree identity differs');
  for (const entry of tree.tree) {
    const isCipher = entry.path === 'ledger.age';
    const bytes = blob(reader, s.repository, entry.sha, entry.size, isCipher ? 32 * 1024 * 1024 : 16 * 1024);
    if (digest(bytes) !== (isCipher ? s.ciphertext_sha256 : s.signature_sha256)) throw Error('Public journal ciphertext/signature digest differs');
  }
  if (publicHead(reader, s) !== s.head) throw Error('Public journal head changed during projection read');
}
