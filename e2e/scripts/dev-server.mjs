import { createServer } from 'node:http'
import { createAttestrackFetchHandler } from '@attestrack/worker-core'
import { allBundledStrategies } from '@attestrack/strategies'
import { createMockHostRuntime, flushMockBackgroundTasks, noopStrategyLoader } from '@attestrack/sdk'

const port = 8791
const secret = 's'.repeat(32)
const host = createMockHostRuntime({
  secrets: { CONSENT_TOKEN_SECRET: secret }
})
const handler = createAttestrackFetchHandler({
  host,
  consentSecretName: 'CONSENT_TOKEN_SECRET',
  bundledStrategies: allBundledStrategies('CONSENT_TOKEN_SECRET'),
  strategyLoader: noopStrategyLoader
})

createServer(async (req, res) => {
  const url = `http://127.0.0.1:${port}${req.url ?? '/'}`
  const chunks = []
  for await (const c of req) {
    chunks.push(c)
  }
  const bodyBuf = Buffer.concat(chunks)
  const hasBody = !['GET', 'HEAD'].includes(req.method ?? 'GET') && bodyBuf.length > 0
  const flatHeaders = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue
    flatHeaders[k] = Array.isArray(v) ? v.join(', ') : v
  }
  const request = new Request(url, {
    method: req.method ?? 'GET',
    headers: flatHeaders,
    body: hasBody ? bodyBuf : undefined
  })
  try {
    const response = await handler(request)
    await flushMockBackgroundTasks(host)
    res.statusCode = response.status
    response.headers.forEach((value, key) => {
      res.setHeader(key, value)
    })
    const ab = await response.arrayBuffer()
    res.end(Buffer.from(ab))
  } catch (e) {
    res.statusCode = 500
    res.end(String(e))
  }
}).listen(port, () => {
  process.stderr.write(`e2e dev server on ${port}\n`)
})
