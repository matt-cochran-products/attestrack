import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEPLOY_STATE_FILENAME,
  readDeployState,
  runInteractiveDeploy,
  type RunCommandFn
} from '../src/index.js'

function seedMinimalMonorepo(root: string) {
  for (const { dir, name } of [
    { dir: 'worker-core', name: '@attestrack/worker-core' },
    { dir: 'host-cloudflare-worker', name: '@attestrack/host-cloudflare-worker' },
    { dir: 'strategies', name: '@attestrack/strategies' }
  ]) {
    const p = join(root, 'packages', dir)
    mkdirSync(p, { recursive: true })
    writeFileSync(join(p, 'package.json'), JSON.stringify({ name, version: '0.0.0' }, null, 2))
  }
}

function captureStdout(): { text: () => string; restore: () => void } {
  const chunks: string[] = []
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((c: unknown) => {
    chunks.push(typeof c === 'string' ? c : String(c))
    return true
  }) as typeof process.stdout.write
  return { text: () => chunks.join(''), restore: () => (process.stdout.write = orig) }
}

function happyRun(calls: string[]): RunCommandFn {
  return async (cmd, args) => {
    const line = [cmd, ...args].join(' ')
    calls.push(line)
    if (line.includes('wrangler whoami')) return { code: 0, stdout: 'you@example.com', stderr: '' }
    if (line.includes('kv') && line.includes('namespace') && line.includes('create')) {
      return { code: 0, stdout: '{ binding = "ATTESTRACK_KV", id = "kv-flow-1" }\n', stderr: '' }
    }
    if (line.includes('npm install')) return { code: 0, stdout: '', stderr: '' }
    if (line.includes('kv') && line.includes('bulk')) return { code: 0, stdout: '', stderr: '' }
    if (line.includes('secret') && line.includes('put')) return { code: 0, stdout: '', stderr: '' }
    if (line.includes('wrangler deploy')) {
      return { code: 0, stdout: 'https://flow.acme.workers.dev\n', stderr: '' }
    }
    return { code: 1, stdout: '', stderr: `unmocked: ${line}` }
  }
}

/** No live network in tests: the CLI.8 post-deploy poll gets an offline stub. */
const offlineVerify = {
  attempts: 1,
  sleep: async () => {},
  fetchFn: async () => {
    throw new Error('offline test stub')
  }
} as const

let tmp: string | null = null
const prevCwd = process.cwd()

afterEach(() => {
  process.chdir(prevCwd)
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = null
  delete process.env.ATTESTRACK_DEPLOY_PACKAGE_RANGE
})

function freshDir(prefix: string): string {
  tmp = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(tmp, { recursive: true })
  process.chdir(tmp)
  return tmp
}

describe('CLI.3 — numbered sequential steps (dry-run rehearses the whole flow)', () => {
  it('dry-run prints step k/N for every step including portal and verify', async () => {
    const dir = freshDir('attest-steps')
    seedMinimalMonorepo(dir)
    const cap = captureStdout()
    try {
      await runInteractiveDeploy({
        scripted: { siteId: 'steps-site', domain: 't.steps.test' },
        dryRun: true,
        runCommand: happyRun([])
      })
      const out = cap.text()
      expect(out).toContain('[step 1/9] Verify Cloudflare authentication')
      expect(out).toContain('[step 2/9] KV namespace')
      expect(out).toContain('[step 3/9] Write scaffold files')
      expect(out).toContain('[step 4/9] Install scaffold dependencies')
      expect(out).toContain('[step 5/9] Seed KV')
      expect(out).toContain('[step 6/9] Set CONSENT_TOKEN_SECRET')
      expect(out).toContain('[step 7/9] Deploy Worker')
      expect(out).toContain('[step 8/9] Build and deploy portal')
      expect(out).toContain('[step 9/9] Verify deployment')
      expect(out).toContain('[dry-run]')
    } finally {
      cap.restore()
    }
  })

  it('--skip-portal drops the portal step (8 steps total)', async () => {
    const dir = freshDir('attest-steps-np')
    seedMinimalMonorepo(dir)
    const cap = captureStdout()
    try {
      await runInteractiveDeploy({
        scripted: { siteId: 's', domain: 't.s.test' },
        dryRun: true,
        skipPortal: true,
        runCommand: happyRun([])
      })
      const out = cap.text()
      expect(out).toContain('[step 8/8] Verify deployment')
      expect(out).not.toContain('deploy portal')
    } finally {
      cap.restore()
    }
  })
})

describe('P5.1 — standalone mode uses published packages (no monorepo file: deps)', () => {
  it('scaffold outside the monorepo depends on published @attestrack/* versions', async () => {
    const dir = freshDir('attest-standalone')
    await runInteractiveDeploy({
      scripted: { siteId: 'solo', domain: 't.solo.test', kvNamespaceId: 'kv-solo' },
      scaffoldOnly: true
    })
    const pkg = JSON.parse(readFileSync(join(dir, 'attestrack-deploy', 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    expect(pkg.dependencies['@attestrack/worker-core']).toBe('latest')
    expect(pkg.dependencies['@attestrack/host-cloudflare-worker']).toBe('latest')
    expect(pkg.dependencies['@attestrack/strategies']).toBe('latest')
    const readme = readFileSync(join(dir, 'attestrack-deploy', 'README.md'), 'utf8')
    expect(readme).toContain('standalone')
  })

  it('ATTESTRACK_DEPLOY_PACKAGE_RANGE pins the published range', async () => {
    const dir = freshDir('attest-standalone-pin')
    process.env.ATTESTRACK_DEPLOY_PACKAGE_RANGE = '^0.2.0'
    await runInteractiveDeploy({
      scripted: { siteId: 'pin', domain: 't.pin.test', kvNamespaceId: 'kv-pin' },
      scaffoldOnly: true
    })
    const pkg = JSON.parse(readFileSync(join(dir, 'attestrack-deploy', 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    expect(pkg.dependencies['@attestrack/worker-core']).toBe('^0.2.0')
  })

  it('monorepo (dev mode) still generates file: deps', async () => {
    const dir = freshDir('attest-devmode')
    seedMinimalMonorepo(dir)
    await runInteractiveDeploy({
      scripted: { siteId: 'dev', domain: 't.dev.test', kvNamespaceId: 'kv-dev' },
      scaffoldOnly: true
    })
    const pkg = JSON.parse(readFileSync(join(dir, 'attestrack-deploy', 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    expect(pkg.dependencies['@attestrack/worker-core']).toContain('file:')
  })
})

describe('CLI.11 — re-run diff display before apply', () => {
  it('shows wrangler.toml and KV-seed diffs on re-run, and aborts when changes are declined', async () => {
    const dir = freshDir('attest-rerun')
    seedMinimalMonorepo(dir)
    const outDir = join(dir, 'attestrack-deploy')
    mkdirSync(outDir, { recursive: true })
    writeFileSync(
      outDir + '/wrangler.toml',
      'name = "attestrack-oldname"\n[[kv_namespaces]]\nbinding = "ATTESTRACK_KV"\nid = "kv-rerun-7"\n'
    )
    writeFileSync(
      outDir + '/kv-seed.json',
      JSON.stringify({ 'attestrack:portal:site_config': '{"old":true}' }, null, 2)
    )
    const calls: string[] = []
    const cap = captureStdout()
    try {
      await runInteractiveDeploy({
        scripted: {
          siteId: 'newname',
          domain: 't.rerun.test',
          reuseExistingScaffold: true,
          consentSecretForPut: '01234567890123456789012345678901'
        },
        skipPortal: true,
        runCommand: happyRun(calls),
        confirmApplyChanges: async () => false // decline
      })
      const out = cap.text()
      expect(out).toContain('Re-run detected')
      expect(out).toContain('- name = "attestrack-oldname"')
      expect(out).toContain('+ name = "attestrack-newname"')
      expect(out).toContain('attestrack:portal:site_config')
      expect(out).toContain('Aborted')
      // Declined ⇒ nothing deployed, existing files untouched.
      expect(calls.join('\n')).not.toContain('wrangler deploy')
      expect(readFileSync(outDir + '/wrangler.toml', 'utf8')).toContain('attestrack-oldname')
    } finally {
      cap.restore()
    }
  })

  it('applies and deploys when changes are accepted', async () => {
    const dir = freshDir('attest-rerun-ok')
    seedMinimalMonorepo(dir)
    const outDir = join(dir, 'attestrack-deploy')
    mkdirSync(outDir, { recursive: true })
    writeFileSync(
      outDir + '/wrangler.toml',
      'name = "attestrack-prior"\n[[kv_namespaces]]\nbinding = "ATTESTRACK_KV"\nid = "kv-keep-1"\n'
    )
    const calls: string[] = []
    const cap = captureStdout()
    try {
      await runInteractiveDeploy({
        scripted: {
          siteId: 'prior',
          domain: 't.prior.test',
          reuseExistingScaffold: true,
          consentSecretForPut: '01234567890123456789012345678901'
        },
        skipPortal: true,
        runCommand: happyRun(calls),
        confirmApplyChanges: async () => true,
        verifyOverrides: offlineVerify
      })
      expect(calls.join('\n')).toContain('wrangler deploy')
      expect(calls.join('\n')).not.toContain('namespace create')
      expect(readFileSync(outDir + '/wrangler.toml', 'utf8')).toContain('kv-keep-1')
    } finally {
      cap.restore()
    }
  })

  it('--skip-seed keeps remote KV untouched (no bulk put) and says so', async () => {
    const dir = freshDir('attest-skipseed')
    seedMinimalMonorepo(dir)
    const calls: string[] = []
    const cap = captureStdout()
    try {
      await runInteractiveDeploy({
        scripted: {
          siteId: 'seedless',
          domain: 't.seedless.test',
          consentSecretForPut: '01234567890123456789012345678901'
        },
        skipPortal: true,
        skipSeed: true,
        runCommand: happyRun(calls),
        verifyOverrides: offlineVerify
      })
      expect(calls.join('\n')).not.toContain('bulk put')
      expect(cap.text()).toContain('skipped (--skip-seed)')
    } finally {
      cap.restore()
    }
  })
})

describe('CLI.4 — recoverable errors offer retry', () => {
  it('retries a failed step when the user confirms, then continues', async () => {
    const dir = freshDir('attest-retry')
    seedMinimalMonorepo(dir)
    let installAttempts = 0
    const retryPrompts: string[] = []
    const calls: string[] = []
    const run: RunCommandFn = async (cmd, args) => {
      const line = [cmd, ...args].join(' ')
      calls.push(line)
      if (line.includes('npm install')) {
        installAttempts += 1
        if (installAttempts === 1) return { code: 1, stdout: '', stderr: 'ETIMEDOUT registry.npmjs.org' }
        return { code: 0, stdout: '', stderr: '' }
      }
      return happyRun([])(cmd, args, { cwd: '' })
    }
    const cap = captureStdout()
    try {
      await runInteractiveDeploy({
        scripted: {
          siteId: 'retry',
          domain: 't.retry.test',
          consentSecretForPut: '01234567890123456789012345678901'
        },
        skipPortal: true,
        runCommand: run,
        confirmRetry: async (msg) => {
          retryPrompts.push(msg)
          return true
        },
        verifyOverrides: offlineVerify
      })
      expect(installAttempts).toBe(2)
      expect(retryPrompts.length).toBe(1)
      expect(retryPrompts[0]).toContain('recoverable')
      expect(calls.join('\n')).toContain('wrangler deploy')
    } finally {
      cap.restore()
    }
  })

  it('declining retry fails the deploy with the step named', async () => {
    const dir = freshDir('attest-retry-no')
    seedMinimalMonorepo(dir)
    const run: RunCommandFn = async (cmd, args) => {
      const line = [cmd, ...args].join(' ')
      if (line.includes('npm install')) return { code: 1, stdout: '', stderr: 'boom' }
      return happyRun([])(cmd, args, { cwd: '' })
    }
    const cap = captureStdout()
    try {
      await expect(
        runInteractiveDeploy({
          scripted: {
            siteId: 'retryno',
            domain: 't.retryno.test',
            consentSecretForPut: '01234567890123456789012345678901'
          },
          skipPortal: true,
          runCommand: run,
          confirmRetry: async () => false
        })
      ).rejects.toThrow(/npm install.*declined retry/s)
    } finally {
      cap.restore()
    }
  })
})

describe('deploy-state.json + post-deploy verification', () => {
  it('writes deploy state and runs the CLI.8 verification poll after deploy', async () => {
    const dir = freshDir('attest-state')
    seedMinimalMonorepo(dir)
    const fetched: string[] = []
    const cap = captureStdout()
    try {
      await runInteractiveDeploy({
        scripted: {
          siteId: 'state',
          domain: 't.state.test',
          consentSecretForPut: '01234567890123456789012345678901'
        },
        skipPortal: true,
        runCommand: happyRun([]),
        verifyOverrides: {
          attempts: 1,
          sleep: async () => {},
          fetchFn: async (url, init) => {
            fetched.push(url)
            const ok = (body: string) => ({
              status: 200,
              headers: { get: () => null },
              text: async () => body
            })
            if (url.endsWith('/consent/commit') && init?.method === 'POST') return ok('{"token":"x"}')
            if (url === 'https://flow.acme.workers.dev/health') return ok('ok')
            throw new Error('unresolvable')
          }
        }
      })
      const state = readDeployState(dir)
      expect(state?.workerUrl).toBe('https://flow.acme.workers.dev')
      expect(state?.siteId).toBe('state')
      expect(existsSync(join(dir, 'attestrack-deploy', DEPLOY_STATE_FILENAME))).toBe(true)
      expect(fetched).toContain('https://flow.acme.workers.dev/health')
      expect(fetched).toContain('https://t.state.test/health')
      const out = cap.text()
      expect(out).toContain('Verify deployment')
      expect(out).toContain('up to 24 hours') // domain still propagating — honest pending message
    } finally {
      cap.restore()
    }
  })
})
