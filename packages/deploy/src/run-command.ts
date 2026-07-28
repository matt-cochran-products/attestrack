import { spawn } from 'node:child_process'
import { maskSecrets } from './mask.js'

export type RunCmdOptions = {
  cwd: string
  env?: NodeJS.ProcessEnv
  /** When true, child uses inherit stdio (interactive `wrangler secret put`). */
  inheritStdio?: boolean
  input?: string
}

export type RunCmdResult = { code: number | null; stdout: string; stderr: string }

export type RunCommandFn = (
  cmd: string,
  args: readonly string[],
  opts: RunCmdOptions
) => Promise<RunCmdResult>

/** Default runner: `npx` + args (shell on Windows for npx.cmd resolution). */
export const defaultRunCommand: RunCommandFn = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, [...args], {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: opts.inheritStdio
        ? 'inherit'
        : [opts.input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32'
    })

    if (!opts.inheritStdio && opts.input !== undefined && child.stdin) {
      child.stdin.write(opts.input)
      child.stdin.end()
    }

    let stdout = ''
    let stderr = ''
    // Echoed child output is masked (CLI.5 / INV-B-10): even if a subprocess
    // misbehaves and echoes a credential back, it never reaches the terminal.
    if (!opts.inheritStdio && child.stdout) {
      child.stdout.on('data', (c: Buffer) => {
        const s = c.toString('utf8')
        stdout += s
        process.stdout.write(maskSecrets(s))
      })
    }
    if (!opts.inheritStdio && child.stderr) {
      child.stderr.on('data', (c: Buffer) => {
        const s = c.toString('utf8')
        stderr += s
        process.stderr.write(maskSecrets(s))
      })
    }

    child.on('error', reject)
    child.on('close', (code) => {
      resolve({ code, stdout, stderr })
    })
  })
