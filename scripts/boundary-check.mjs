#!/usr/bin/env node
/**
 * ADR-009: forbidden paths must not exist in the public Attestrack repo.
 * `packages/merkle` is permanently withdrawn (ADR-002, token standard v9.2).
 * `packages/consent-js` is part of the public community consent path (allowed).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const forbidden = ['packages/merkle'];

let failed = false;
for (const rel of forbidden) {
  const p = path.join(root, rel);
  if (fs.existsSync(p)) {
    console.error(`[boundary-check] Forbidden path exists: ${rel}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
console.log('[boundary-check] OK');
