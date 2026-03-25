#!/usr/bin/env node
/**
 * ADR-009: forbidden paths must not exist in the public Attestrack repo.
 * Optional: fail if licensed-only sibling repo name appears in source/docs.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const forbiddenPaths = ['packages/merkle']

/** Built without a single literal so this script does not self-trigger text scan. */
const licensedSiblingName = ['attestrue', 'premium'].join('-')

const scanIgnoreDir = new Set([
  'node_modules',
  'dist',
  '.git',
  '.turbo',
  'coverage',
  '.cursor'
])

const scanExtensions = new Set([
  '.md',
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.yml',
  '.yaml',
  '.astro'
])

function walkFiles (dir, out = []) {
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const ent of entries) {
    const rel = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (scanIgnoreDir.has(ent.name)) continue
      walkFiles(rel, out)
    } else {
      const ext = path.extname(ent.name)
      if (scanExtensions.has(ext)) out.push(rel)
    }
  }
  return out
}

let failed = false

for (const rel of forbiddenPaths) {
  const p = path.join(root, rel)
  if (fs.existsSync(p)) {
    console.error(`[boundary-check] Forbidden path exists: ${rel}`)
    failed = true
  }
}

const thisScript = fileURLToPath(import.meta.url)
const files = walkFiles(root)
for (const file of files) {
  if (file === thisScript) continue
  let text = ''
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    continue
  }
  if (text.includes(licensedSiblingName)) {
    console.error(
      `[boundary-check] Forbidden reference "${licensedSiblingName}" in ${path.relative(root, file)}`
    )
    failed = true
  }
}

if (failed) {
  process.exit(1)
}
console.log('[boundary-check] OK')
