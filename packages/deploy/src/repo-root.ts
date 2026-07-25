import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

function isWorkerCorePackage(path: string): boolean {
  if (!existsSync(path)) return false
  try {
    const pkg = JSON.parse(readFileSync(path, 'utf8')) as { name?: string }
    return pkg.name === '@attestrack/worker-core'
  } catch {
    return false
  }
}

/** Walks up from `start` looking for the attestrue monorepo root (packages/worker-core). */
export function findAttestrueMonorepoRoot(start: string): string | null {
  let dir = resolve(start)
  for (let i = 0; i < 10; i++) {
    const wc = join(dir, 'packages', 'worker-core', 'package.json')
    if (isWorkerCorePackage(wc)) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

export function relativeFileDep(fromDir: string, absPackageDir: string): string {
  const rel = relativePosix(fromDir, absPackageDir)
  return rel.startsWith('.') ? `file:${rel}` : `file:./${rel}`
}

function relativePosix(from: string, to: string): string {
  let r = relative(from, to)
  if (process.platform === 'win32') {
    r = r.replace(/\\/g, '/')
  }
  return r
}
