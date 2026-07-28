/** Extract Cloudflare KV namespace id from `wrangler kv namespace create` stdout. */
export function parseKvNamespaceIdFromCreateOutput(text: string): string | null {
  const m = text.match(/id\s*=\s*"([^"]+)"/u)
  return m?.[1] ?? null
}

/** Extract first workers.dev URL from wrangler deploy output. */
export function parseWorkersDevUrl(text: string): string | null {
  const m = text.match(/\bhttps:\/\/[a-z0-9][-a-z0-9._]*\.workers\.dev\b/iu)
  return m?.[0] ?? null
}

/** Extract first pages.dev URL from wrangler pages deploy output. */
export function parsePagesDevUrl(text: string): string | null {
  const m = text.match(/\bhttps:\/\/[a-z0-9][-a-z0-9._]*\.pages\.dev\b/iu)
  return m?.[0] ?? null
}
