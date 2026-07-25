import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KV_KEY_ENABLED_STRATEGIES } from '@attestrack/types'
import { runInteractiveDeploy, type RunCommandFn } from '../src/index.js'

function seedMinimalMonorepo(root: string) {
  const pkgs: { dir: string; name: string }[] = [
    { dir: 'worker-core', name: '@attestrack/worker-core' },
    { dir: 'host-cloudflare-worker', name: '@attestrack/host-cloudflare-worker' },
    { dir: 'strategies', name: '@attestrack/strategies' }
  ]
  for (const { dir, name } of pkgs) {
    const p = join(root, 'packages', dir)
    mkdirSync(p, { recursive: true })
    writeFileSync(join(p, 'package.json'), JSON.stringify({ name, version: '0.0.0' }, null, 2))
  }
}

describe('runInteractiveDeploy (CLI contract)', () => {
  it('writes scaffold with scripted answers (scaffold-only)', async () => {
    const dir = join(tmpdir(), `attest-deploy-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const prev = process.cwd()
    process.chdir(dir)
    try {
      await runInteractiveDeploy({
        scripted: {
          siteId: 'acme-cli',
          domain: 't.acme.test',
          kvNamespaceId: 'kv-ns-test'
        },
        scaffoldOnly: true
      })
      const out = join(dir, 'attestrack-deploy')
      const toml = readFileSync(join(out, 'wrangler.toml'), 'utf8')
      expect(toml).toContain('acme-cli')
      expect(toml).toContain('kv-ns-test')
      const worker = readFileSync(join(out, 'worker.ts'), 'utf8')
      expect(worker).toContain('createAttestrackFetchHandler')
      const seed = readFileSync(join(out, 'kv-seed.json'), 'utf8')
      expect(seed).toContain('acme-cli')
      expect(seed).toContain('t.acme.test')
      expect(seed).toContain(KV_KEY_ENABLED_STRATEGIES)
    } finally {
      process.chdir(prev)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('orchestrates post-scaffold steps with injected run (skip portal)', async () => {
    const dir = join(tmpdir(), `attest-deploy-full-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    seedMinimalMonorepo(dir)
    const prev = process.cwd()
    process.chdir(dir)
    const calls: string[] = []
    const run: RunCommandFn = async (cmd, args) => {
      calls.push([cmd, ...args].join(' '))
      const line = [cmd, ...args].join(' ')
      if (line.includes('wrangler whoami')) return { code: 0, stdout: 'test@example.com', stderr: '' }
      if (line.includes('wrangler') && line.includes('kv') && line.includes('namespace') && line.includes('create')) {
        return { code: 0, stdout: '{ binding = "ATTESTRACK_KV", id = "cf-kv-orchestrate-1" }\n', stderr: '' }
      }
      if (line.includes('npm install')) return { code: 0, stdout: '', stderr: '' }
      if (line.includes('wrangler') && line.includes('kv') && line.includes('bulk')) {
        return { code: 0, stdout: '', stderr: '' }
      }
      if (line.includes('wrangler') && line.includes('secret') && line.includes('put')) {
        return { code: 0, stdout: '', stderr: '' }
      }
      if (line.includes('wrangler deploy')) {
        return { code: 0, stdout: 'https://acme-orchestrate.sub.workers.dev\n', stderr: '' }
      }
      return { code: 1, stdout: '', stderr: `unmocked: ${line}` }
    }
    try {
      await runInteractiveDeploy({
        scripted: {
          siteId: 'orch',
          domain: 't.orch.test',
          consentSecretForPut: '01234567890123456789012345678901'
        },
        skipPortal: true,
        runCommand: run
      })
      const joined = calls.join('\n')
      expect(joined).toMatch(/wrangler whoami/)
      expect(joined).toMatch(/wrangler kv namespace create/)
      expect(joined).toMatch(/npm install/)
      expect(joined).toMatch(/wrangler kv bulk put/)
      expect(joined).toMatch(/wrangler secret put CONSENT_TOKEN_SECRET/)
      expect(joined).toMatch(/wrangler deploy/)
      expect(joined).not.toMatch(/wrangler pages deploy/)
      const toml = readFileSync(join(dir, 'attestrack-deploy', 'wrangler.toml'), 'utf8')
      expect(toml).toContain('cf-kv-orchestrate-1')
    } finally {
      process.chdir(prev)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('CLI.11: reuses KV from existing wrangler.toml when reuseExistingScaffold (no namespace create)', async () => {
    const dir = join(tmpdir(), `attest-deploy-reuse-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    seedMinimalMonorepo(dir)
    const outDir = join(dir, 'attestrack-deploy')
    mkdirSync(outDir, { recursive: true })
    writeFileSync(
      join(outDir, 'wrangler.toml'),
      `name = "attestrack-prior"
[[kv_namespaces]]
binding = "ATTESTRACK_KV"
id = "existing-kv-reuse-99"
`
    )
    const prev = process.cwd()
    process.chdir(dir)
    const calls: string[] = []
    const run: RunCommandFn = async (cmd, args) => {
      calls.push([cmd, ...args].join(' '))
      const line = [cmd, ...args].join(' ')
      if (line.includes('wrangler whoami')) return { code: 0, stdout: 'ok', stderr: '' }
      if (line.includes('kv') && line.includes('namespace') && line.includes('create')) {
        return { code: 1, stdout: '', stderr: 'should not create namespace' }
      }
      if (line.includes('npm install')) return { code: 0, stdout: '', stderr: '' }
      if (line.includes('wrangler') && line.includes('kv') && line.includes('bulk')) {
        return { code: 0, stdout: '', stderr: '' }
      }
      if (line.includes('wrangler') && line.includes('secret') && line.includes('put')) {
        return { code: 0, stdout: '', stderr: '' }
      }
      if (line.includes('wrangler deploy')) {
        return { code: 0, stdout: 'https://reuse.example.workers.dev\n', stderr: '' }
      }
      return { code: 1, stdout: '', stderr: `unmocked: ${line}` }
    }
    try {
      await runInteractiveDeploy({
        scripted: {
          siteId: 'reuse-site',
          domain: 't.reuse.test',
          consentSecretForPut: '01234567890123456789012345678901',
          reuseExistingScaffold: true
        },
        skipPortal: true,
        runCommand: run
      })
      const joined = calls.join('\n')
      expect(joined).not.toMatch(/kv namespace create/)
      expect(joined).toMatch(/wrangler deploy/)
      const toml = readFileSync(join(outDir, 'wrangler.toml'), 'utf8')
      expect(toml).toContain('existing-kv-reuse-99')
    } finally {
      process.chdir(prev)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
