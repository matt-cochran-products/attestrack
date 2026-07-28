export const R2_SETUP_README = [
  '# Optional R2 buckets',
  '',
  'Community Attestrack stores consent event pointers in KV by default.',
  'If you enable licensed extensions that require object storage, create an R2 bucket',
  'in your Cloudflare account and bind it in wrangler.toml under `[[r2_buckets]]`.',
  '',
  'Object Lock and versioning are recommended for counsel-facing retention policies —',
  'see your Attestrue deployment guide when using those SKUs.'
].join('\n')
