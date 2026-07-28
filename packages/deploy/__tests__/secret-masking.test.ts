import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearRegisteredSecretsForTest,
  defaultRunCommand,
  maskSecrets,
  registerSecret,
  runInteractiveDeploy,
  type RunCommandFn
} from '../src/index.js'

const SECRET = 'sup3r-secret-consent-token-0123456789'

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

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walkFiles(p, out)
    else out.push(p)
  }
  return out
}

type CapturedOutput = { text: string; restore: () => void }

function captureProcessOutput(): CapturedOutput {
  const chunks: string[] = []
  const origOut = process.stdout.write.bind(process.stdout)
  const origErr = process.stderr.write.bind(process.stderr)
  const capture = (c: unknown): boolean => {
    chunks.push(typeof c === 'string' ? c : String(c))
    return true
  }
  process.stdout.write = capture as typeof process.stdout.write
  process.stderr.write = capture as typeof process.stderr.write
  return {
    get text() {
      return chunks.join('')
    },
    restore: () => {
      process.stdout.write = origOut
      process.stderr.write = origErr
    }
  }
}

describe('INV-B-10 — secrets never reach stdout/stderr/logs (CLI.5)', () => {
  beforeEach(() => clearRegisteredSecretsForTest())
  afterEach(() => clearRegisteredSecretsForTest())

  it('maskSecrets replaces registered secrets everywhere in a string', () => {
    registerSecret(SECRET)
    expect(maskSecrets(`before ${SECRET} mid ${SECRET} after`)).toBe('before *** mid *** after')
    expect(maskSecrets('no secret here')).toBe('no secret here')
  })

  it('does not register trivially short values (would corrupt output)', () => {
    registerSecret('ab')
    expect(maskSecrets('cab bag')).toBe('cab bag')
  })

  it('defaultRunCommand masks child stdout/stderr echo (misbehaving subprocess)', async () => {
    registerSecret(SECRET)
    const cap = captureProcessOutput()
    try {
      const res = await defaultRunCommand(
        process.execPath,
        ['-e', `console.log('leak:' + process.argv[1]); console.error('errleak:' + process.argv[1])`, SECRET],
        { cwd: process.cwd() }
      )
      expect(res.code).toBe(0)
      // The raw value is captured internally (needed for parsing) …
      expect(res.stdout).toContain(SECRET)
      // … but what reached the terminal is masked.
      expect(cap.text).not.toContain(SECRET)
      expect(cap.text).toContain('leak:***')
      expect(cap.text).toContain('errleak:***')
    } finally {
      cap.restore()
    }
  })

  it('full scripted deploy never writes the consent secret to stdout/stderr, thrown errors, or scaffold files', async () => {
    const dir = join(tmpdir(), `attest-mask-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    seedMinimalMonorepo(dir)
    const prev = process.cwd()
    process.chdir(dir)
    const cap = captureProcessOutput()
    const run: RunCommandFn = async (cmd, args) => {
      const line = [cmd, ...args].join(' ')
      if (line.includes('wrangler whoami')) return { code: 0, stdout: 'ok', stderr: '' }
      if (line.includes('kv') && line.includes('namespace') && line.includes('create')) {
        return { code: 0, stdout: '{ binding = "ATTESTRACK_KV", id = "kv-mask-1" }\n', stderr: '' }
      }
      if (line.includes('npm install')) return { code: 0, stdout: '', stderr: '' }
      if (line.includes('kv') && line.includes('bulk')) return { code: 0, stdout: '', stderr: '' }
      if (line.includes('secret') && line.includes('put')) {
        // Misbehaving subprocess: echoes the piped secret back on stdout.
        return { code: 0, stdout: `echoed: ${SECRET}\n`, stderr: '' }
      }
      if (line.includes('wrangler deploy')) {
        // Failure path whose message embeds the secret — the thrown error must be masked.
        return { code: 1, stdout: '', stderr: `deploy blew up, env dump: CONSENT_TOKEN_SECRET=${SECRET}` }
      }
      return { code: 1, stdout: '', stderr: `unmocked: ${line}` }
    }
    let thrown: unknown
    try {
      await runInteractiveDeploy({
        scripted: { siteId: 'mask-site', domain: 't.mask.test', consentSecretForPut: SECRET },
        skipPortal: true,
        runCommand: run
      }).catch((e: unknown) => {
        thrown = e
      })
      expect(thrown).toBeInstanceOf(Error)
      expect((thrown as Error).message).not.toContain(SECRET)
      expect((thrown as Error).message).toContain('***')
      expect(cap.text).not.toContain(SECRET)
      for (const file of walkFiles(join(dir, 'attestrack-deploy'))) {
        expect(readFileSync(file, 'utf8'), `secret leaked into ${file}`).not.toContain(SECRET)
      }
    } finally {
      cap.restore()
      process.chdir(prev)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
