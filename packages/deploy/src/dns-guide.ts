export function formatDnsInstructions(hostname: string, workersTarget: string): string {
  return [
    'DNS — point your tracking hostname to Cloudflare Workers:',
    '',
    `  Host: ${hostname}`,
    `  Type: CNAME`,
    `  Target: ${workersTarget}`,
    '',
    'Propagation can take up to 24 hours. Confirm in the Cloudflare dashboard that the route is attached to your Worker.'
  ].join('\n')
}
