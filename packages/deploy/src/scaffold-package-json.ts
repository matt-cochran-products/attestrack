export type ScaffoldPackageJsonOptions = {
  workerCore: string
  hostCloudflareWorker: string
  strategies: string
  /** e.g. "^3.99.0" */
  wranglerSemver: string
}

/**
 * Standalone (npx) mode: the scaffold depends on the *published*
 * `@attestrack/*` packages instead of monorepo `file:` paths. The runtime
 * packages are released together from one repository, so the `latest`
 * dist-tag is always a mutually compatible set. Override with
 * `ATTESTRACK_DEPLOY_PACKAGE_RANGE` (e.g. `^0.1.0`) to pin.
 */
export const STANDALONE_DEPENDENCY_RANGE_DEFAULT = 'latest'

export function standaloneDependencySpecifiers(range?: string): Pick<
  ScaffoldPackageJsonOptions,
  'workerCore' | 'hostCloudflareWorker' | 'strategies'
> {
  const r =
    range ?? process.env.ATTESTRACK_DEPLOY_PACKAGE_RANGE ?? STANDALONE_DEPENDENCY_RANGE_DEFAULT
  return { workerCore: r, hostCloudflareWorker: r, strategies: r }
}

export function buildScaffoldPackageJson(opts: ScaffoldPackageJsonOptions): string {
  const pkg = {
    name: 'attestrack-worker',
    private: true,
    type: 'module',
    scripts: {
      deploy: 'wrangler deploy'
    },
    dependencies: {
      '@attestrack/worker-core': opts.workerCore,
      '@attestrack/host-cloudflare-worker': opts.hostCloudflareWorker,
      '@attestrack/strategies': opts.strategies
    },
    devDependencies: {
      wrangler: opts.wranglerSemver
    }
  }
  return `${JSON.stringify(pkg, null, 2)}\n`
}
