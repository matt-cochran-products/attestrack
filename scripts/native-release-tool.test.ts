import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { assetHash, loadTool, packageTool, TOOL_FILES, TOOL_INTEGRITY, TOOL_PROFILE, verifyTool, type Tool } from './native-release-tool.ts';

/** CI already installs the locked deploy package for source tests; writer never installs it. */
export function upstreamTool(): Tool {
  const requireDeploy = createRequire(new URL('../packages/deploy/package.json', import.meta.url));
  const requireWrangler = createRequire(requireDeploy.resolve('wrangler/package.json'));
  const root = dirname(requireWrangler.resolve('blake3-wasm/package.json'));
  return { schema: 'attestrack.native-release-tool/v1', profile_sha256: TOOL_PROFILE,
    files: Object.fromEntries(Object.keys(TOOL_FILES).map(p => [p, readFileSync(join(root, p)).toString('base64')])) };
}
test('locked upstream BLAKE3 runtime loads only complete pinned JS/Wasm closure and matches official vectors', () => {
  const directory = mkdtempSync(join(tmpdir(), 'attestrack-uploader-vector-'));
  try {
    const runtime = loadTool(upstreamTool(), join(directory, 'runtime'));
    assert.equal(runtime.hash('').toString('hex'), 'af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262');
    assert.equal(runtime.hash('abc').toString('hex'), '6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85');
    // BLAKE3-team test_vectors.json: input[i] = i % 251, including a chunk boundary.
    for (const [length, expected] of [[3, 'e1be4d7a8ab5560aa4199eea339849ba8e293d55ca0a81006726d184519e647f'],
      [1024, '42214739f095a406f3fc83deb889744ac00df831c10daa55189b5d121c855af7'],
      [1025, 'd00278ae47eb27b34faecf67b4fe263f82d5412916c1ffd97c8cb7fb814b8444']] as const) {
      assert.equal(runtime.hash(Buffer.from(Array.from({ length }, (_, i) => i % 251))).toString('hex'), expected);
    }
    assert.equal(assetHash(runtime, 'index.html', Buffer.from('abc')), runtime.hash('YWJjhtml').toString('hex').slice(0, 32));
    assert.notEqual(assetHash(runtime, 'index.html', Buffer.from('abc')), assetHash(runtime, 'index.js', Buffer.from('abc')));
    runtime.assertUnchanged();
    chmodSync(join(directory, 'runtime/dist/node/hash-fn.js'), 0o600);
    writeFileSync(join(directory, 'runtime/dist/node/hash-fn.js'), 'changed');
    assert.throws(() => runtime.assertUnchanged(), /drift/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('tool package/inner closure refuses wrong outer integrity, missing/extra/modified files and false version-only identity', () => {
  const tool = upstreamTool(); verifyTool(tool);
  assert.throws(() => packageTool(Buffer.from('not original npm archive')), /integrity/);
  for (const mutate of [(t: Tool) => { delete t.files.LICENSE; }, (t: Tool) => { t.files['extra.js'] = ''; },
    (t: Tool) => { t.files['dist/wasm/nodejs/blake3_js_bg.wasm'] = Buffer.from('altered').toString('base64'); },
    (t: Tool) => { t.profile_sha256 = 'a'.repeat(64); }]) { const t = structuredClone(tool); mutate(t); assert.throws(() => verifyTool(t)); }
  assert.ok(readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8').includes(TOOL_INTEGRITY));
});
