// Local attestrue Worker for self-host / dogfood dev.
//
// Runs the real Attestrack fetch handler (worker-core + all bundled strategies)
// on a plain Node HTTP server, with the ClickHouse analytics strategy enabled by
// simply providing CLICKHOUSE_HTTP_URL. (When KV_KEY_ENABLED_STRATEGIES is
// absent, the pipeline allows all optional strategies — see
// packages/worker-core/src/enabled-strategies.ts — so no KV seeding is needed.)
//
// Env:
//   PORT                  default 8799
//   CLICKHOUSE_HTTP_URL   full ClickHouse HTTP INSERT endpoint. Default targets a
//                         local ClickHouse: INSERT INTO attestrue.tracking_events
//                         FORMAT JSONEachRow (best_effort datetime parsing so the
//                         event's ISO occurredAt maps to DateTime64).
//   CLICKHOUSE_USER / CLICKHOUSE_PASSWORD  optional basic-auth.
//
// Ship a tflo signal here with the tflo→attestrue adapter (a POST to /t/event).
import { createServer } from 'node:http'
import { createAttestrackFetchHandler } from '@attestrue/worker-core'
import { allBundledStrategies } from '@attestrue/strategies'
import { createMockHostRuntime, flushMockBackgroundTasks, noopStrategyLoader } from '@attestrue/sdk'

const port = Number(process.env.PORT ?? 8799)
const clickhouseUrl =
  process.env.CLICKHOUSE_HTTP_URL ??
  'http://localhost:8123/?date_time_input_format=best_effort&query=' +
    encodeURIComponent('INSERT INTO attestrue.tracking_events FORMAT JSONEachRow')

const host = createMockHostRuntime({
  secrets: {
    CONSENT_TOKEN_SECRET: 's'.repeat(32),
    CLICKHOUSE_HTTP_URL: clickhouseUrl,
    CLICKHOUSE_USER: process.env.CLICKHOUSE_USER,
    CLICKHOUSE_PASSWORD: process.env.CLICKHOUSE_PASSWORD,
    // Dual-sink: setting the OTLP endpoint activates the `otel` strategy so the
    // same /t/event also emits a high-level OTLP log (→ SigNoz).
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    OTEL_EXPORTER_OTLP_HEADERS: process.env.OTEL_EXPORTER_OTLP_HEADERS,
    OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME
  }
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
  for await (const c of req) chunks.push(c)
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
    await flushMockBackgroundTasks(host) // run the CH sink synchronously for dev
    res.statusCode = response.status
    response.headers.forEach((value, key) => res.setHeader(key, value))
    res.end(Buffer.from(await response.arrayBuffer()))
  } catch (e) {
    res.statusCode = 500
    res.end(String(e))
  }
}).listen(port, () => {
  process.stderr.write(`attestrue local Worker on ${port} → ClickHouse ${clickhouseUrl.split('?')[0]}\n`)
})
