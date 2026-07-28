/**
 * BEH CLI.8 — plain-language DNS/routing instructions. Honest about how
 * Workers routing actually works: a bare CNAME to workers.dev does NOT route
 * traffic through the Worker — the hostname must be attached to the Worker as
 * a Custom Domain (zone on Cloudflare) or the CNAME target must be proxied.
 */
export function formatDnsInstructions(hostname: string, workersTarget: string): string {
  return [
    `DNS — serve your Worker at ${hostname}:`,
    '',
    'Option A (recommended — your zone is on Cloudflare):',
    '  1. Cloudflare dashboard → Workers & Pages → your Worker → Settings → Domains & Routes → Add → Custom Domain',
    `  2. Enter: ${hostname}`,
    '  Cloudflare creates and manages the DNS record for you — nothing else to do.',
    '',
    'Option B (zone managed elsewhere):',
    `  Host: ${hostname}`,
    '  Type: CNAME',
    `  Target: ${workersTarget}`,
    '  The record must resolve through Cloudflare (orange-cloud proxied) for the Worker to answer;',
    '  a plain CNAME from an external DNS provider will not route through your Worker.',
    '',
    'Propagation can take up to 24 hours. You do not need to understand DNS timing —',
    'just wait, then confirm with:',
    '',
    '  npx @attestrack/deploy verify',
    '',
    `which polls https://${hostname}/health until the route answers.`
  ].join('\n')
}
