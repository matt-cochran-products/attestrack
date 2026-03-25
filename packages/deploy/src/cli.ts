#!/usr/bin/env node
import { runInteractiveDeploy } from './index.js'

const args = process.argv.slice(2)
const scaffoldOnly = args.includes('--scaffold-only')
const skipPortal = args.includes('--skip-portal')
const reuseExistingKvWhenPresent = args.includes('--reuse-kv')

void runInteractiveDeploy({ scaffoldOnly, skipPortal, reuseExistingKvWhenPresent }).catch(
  (err: unknown) => {
    console.error(err)
    process.exit(1)
  }
)
