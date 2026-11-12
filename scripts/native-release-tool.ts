/** Public uploader tool bytes, separate from the candidate application/dependencies. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, lstatSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export const TOOL_URL = 'https://registry.npmjs.org/blake3-wasm/-/blake3-wasm-2.1.5.tgz';
export const TOOL_INTEGRITY = 'sha512-F1+K8EbfOZE49dtoPtmxUQrpXaBIl3ICvasLh+nJta0xkz+9kF/7uet9fLnwKqhDrmj6g+6K3Tw9yQPUg2ka5g==';
// Exact unmodified upstream runtime closure; package license retained. No npm hooks.
export const TOOL_FILES: Readonly<Record<string, string>> = Object.freeze({
  'LICENSE': '6ae51be712bd278ca37cd2204a6e836d71aacea5b7b8210d5a95c0e02a15dc35',
  'dist/base/hash-fn.js': 'ea96a6725f1b0281a59a643f9542a04678d35feb45a46924c59250fa3931c949',
  'dist/node/hash-fn.js': '9bc8115f1a5a55115170afb9cc5d85cfd7f2c8a7e19bbfa363d81f265093dc85',
  'dist/wasm/nodejs/blake3_js.js': '6be3f27f1efe8a8be162d16e060311f7ccf7c9f746e24c47acd43f25239131f2',
  'dist/wasm/nodejs/blake3_js_bg.wasm': '2dcc96fd2bd25392060d166e96cabbd2574cc1fedd32aa0233871c641c897c9f',
  'package.json': 'f36864b59bcb76e6a97b7f236ad3ca78749af8374453ae1bcca048815b8c6e9e',
});
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
export const TOOL_PROFILE = sha(JSON.stringify([TOOL_URL, TOOL_INTEGRITY, TOOL_FILES]));
export interface Tool { schema: 'attestrack.native-release-tool/v1'; profile_sha256: string; files: Record<string, string> }
export interface HashRuntime { readonly hash: (bytes: Buffer | string) => Buffer; readonly assertUnchanged: () => void }
const loadedTools = new WeakSet<HashRuntime>();
export function packageTool(tgz: Buffer): Tool {
  if (tgz.length > 4 * 1024 * 1024 || `sha512-${createHash('sha512').update(tgz).digest('base64')}` !== TOOL_INTEGRITY) throw new Error('Uploader package integrity mismatch');
  // Read only fixed regular members; never extract arbitrary archive paths or run npm.
  const script = 'import sys,tarfile,io,json,base64\nt=tarfile.open(fileobj=io.BytesIO(sys.stdin.buffer.read()),mode="r:gz")\na=t.getmembers(); out={}\nfor p in json.loads(sys.argv[1]):\n m=[m for m in a if m.name=="package/"+p]; assert len(m)==1 and m[0].isfile() and m[0].size<1048576\n out[p]=base64.b64encode(t.extractfile(m[0]).read()).decode()\nprint(json.dumps(out))';
  const tool: Tool = { schema: 'attestrack.native-release-tool/v1', profile_sha256: TOOL_PROFILE,
    files: JSON.parse(execFileSync('python3', ['-c', script, JSON.stringify(Object.keys(TOOL_FILES))], { input: tgz, timeout: 30000, maxBuffer: 4 * 1024 * 1024 }).toString()) };
  verifyTool(tool); return tool;
}
export function verifyTool(raw: unknown): Tool {
  const t = raw as Tool;
  if (!t || Object.keys(t).sort().join() !== 'files,profile_sha256,schema' || t.schema !== 'attestrack.native-release-tool/v1'
      || t.profile_sha256 !== TOOL_PROFILE || !t.files || Object.keys(t.files).sort().join() !== Object.keys(TOOL_FILES).sort().join()) throw new Error('Unreviewed uploader closure');
  for (const [p, expected] of Object.entries(TOOL_FILES)) {
    if (typeof t.files[p] !== 'string' || t.files[p].length > 2 * 1024 * 1024) throw new Error('Invalid uploader file');
    const b = Buffer.from(t.files[p], 'base64');
    if (b.toString('base64') !== t.files[p] || sha(b) !== expected) throw new Error('Uploader file identity mismatch');
  }
  return t;
}
/** Caller uses a fresh, trusted, browser-inaccessible directory. No candidate code loaded. */
export function loadTool(raw: unknown, directory: string): HashRuntime {
  const t = verifyTool(raw); mkdirSync(directory, { recursive: false });
  for (const [p, bytes] of Object.entries(t.files)) {
    mkdirSync(dirname(join(directory, p)), { recursive: true });
    writeFileSync(join(directory, p), Buffer.from(bytes, 'base64'), { flag: 'wx', mode: 0o400 });
  }
  const assertUnchanged = () => {
    const found: string[] = [];
    const walk = (d: string, prefix: string) => { for (const n of readdirSync(d).sort()) {
      const p = prefix ? `${prefix}/${n}` : n, f = join(d, n), s = lstatSync(f);
      if (s.isDirectory()) walk(f, p);
      else if (s.isFile() && !s.isSymbolicLink()) { found.push(p); if (sha(readFileSync(f)) !== TOOL_FILES[p]) throw new Error('Uploader source drift'); }
      else throw new Error('Nonregular uploader closure');
    } }; walk(directory, '');
    if (found.sort().join() !== Object.keys(TOOL_FILES).sort().join()) throw new Error('Uploader closure drift');
  };
  assertUnchanged();
  const loaded = createRequire(pathToFileURL(join(resolve(directory), 'package.json')))('./dist/node/hash-fn.js') as { hash: (b: Buffer | string) => Buffer };
  if (typeof loaded.hash !== 'function') throw new Error('Missing uploader hash');
  assertUnchanged(); const runtime = Object.freeze({ hash: loaded.hash, assertUnchanged }); loadedTools.add(runtime); return runtime;
}
export function requireTool(tool: HashRuntime): void {
  if (!loadedTools.has(tool)) throw new Error('Pinned uploader runtime required');
  tool.assertUnchanged();
}
/** Cloudflare deploy-helpers hashFile: BLAKE3(base64(file)+extension), first16bytes. */
export function assetHash(tool: ReturnType<typeof loadTool>, path: string, bytes: Buffer): string {
  requireTool(tool); return tool.hash(bytes.toString('base64') + extname(path).slice(1)).toString('hex').slice(0, 32);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw new Error('Expected exact public tool output path');
  const r = await fetch(TOOL_URL, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!r.ok || Number(r.headers.get('content-length') ?? 0) > 4 * 1024 * 1024) throw new Error('Public tool fetch failed');
  const reader = r.body!.getReader(); const parts: Buffer[] = []; let length = 0;
  for (;;) { const next = await reader.read(); if (next.done) break; length += next.value.length; if (length > 4 * 1024 * 1024) { await reader.cancel(); throw new Error('Public tool size exceeded'); } parts.push(Buffer.from(next.value)); }
  writeFileSync(process.argv[2], JSON.stringify(packageTool(Buffer.concat(parts))), { flag: 'wx' });
}
