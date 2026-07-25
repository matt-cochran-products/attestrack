export type ScaffoldPackageJsonOptions = {
  workerCore: string
  hostCloudflareWorker: string
  strategies: string
  /** e.g. "^3.99.0" */
  wranglerSemver: string
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
