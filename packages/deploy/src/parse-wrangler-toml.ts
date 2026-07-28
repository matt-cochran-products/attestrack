/** Extract `ATTESTRACK_KV` namespace id from a generated `wrangler.toml`. */
export function parseKvNamespaceIdFromWranglerToml(toml: string): string | null {
  const m = toml.match(
    /binding\s*=\s*"ATTESTRACK_KV"[\s\S]*?id\s*=\s*"([^"]+)"/u
  )
  const id = m?.[1]?.trim()
  if (!id || id === 'REPLACE_WITH_KV_NAMESPACE_ID' || id === 'dry-run-kv-id') return null
  return id
}
