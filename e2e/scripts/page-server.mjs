/**
 * E2E page host (port 8788) — the "customer site" origin, distinct from the
 * worker origin (port 8791) so consent journeys exercise the REAL cross-origin
 * topology (page on www., worker on t. — P2.1).
 *
 * Serves:
 * - /banner.html          consent banner harness (loads /consent.js FROM THE WORKER, cross-origin)
 * - /e2e-clickhouse/*     mock ClickHouse HTTP endpoint (FORMAT JSON) so Explore
 *                         round-trips through the Worker query proxy hit a warehouse
 * - /__attestrack__/*     same-origin proxy to the worker — mirrors production where
 *                         portal SPA and Worker share a hostname (portal API has no CORS by design)
 * - everything else       portal-community build (SPA fallback to index.html) when present
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = 8788
const WORKER = 'http://127.0.0.1:8791'
const e2eRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const pagesDir = join(e2eRoot, 'pages')
const portalDist = join(e2eRoot, '.portal-dist')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json'
}

async function serveFile(res, filePath) {
  try {
    const body = await readFile(filePath)
    res.statusCode = 200
    res.setHeader('content-type', MIME[extname(filePath)] ?? 'application/octet-stream')
    res.end(body)
    return true
  } catch {
    return false
  }
}

function mockClickHouse(req, res) {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const sql = Buffer.concat(chunks).toString('utf8')
    // Reject non-SELECT defensively — the Worker SQL gate should never let one through.
    if (!/^\s*select/iu.test(sql)) {
      res.statusCode = 400
      res.end(JSON.stringify({ exception: 'e2e mock: only SELECT is served' }))
      return
    }
    res.statusCode = 200
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify({
        meta: [{ name: 'eventName' }, { name: 'count' }],
        data: [
          { eventName: 'page_view', count: 42 },
          { eventName: 'e2e_click', count: 7 }
        ],
        rows: 2
      })
    )
  })
}

async function proxyToWorker(req, res) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const body = Buffer.concat(chunks)
  const headers = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined || k === 'host' || k === 'connection') continue
    headers[k] = Array.isArray(v) ? v.join(', ') : v
  }
  try {
    const upstream = await fetch(`${WORKER}${req.url}`, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method ?? 'GET') || body.length === 0 ? undefined : body,
      redirect: 'manual'
    })
    res.statusCode = upstream.status
    upstream.headers.forEach((value, key) => {
      if (key === 'content-encoding' || key === 'transfer-encoding') return
      res.setHeader(key, value)
    })
    res.end(Buffer.from(await upstream.arrayBuffer()))
  } catch (e) {
    res.statusCode = 502
    res.end(`e2e proxy error: ${String(e)}`)
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)
  const path = normalize(url.pathname)

  if (path.startsWith('/e2e-clickhouse')) return mockClickHouse(req, res)
  if (path.startsWith('/__attestrack__/') || path === '/t/event' || path === '/health') {
    return proxyToWorker(req, res)
  }
  if (path.endsWith('.html') && (await serveFile(res, join(pagesDir, path)))) return
  if (path !== '/' && (await serveFile(res, join(portalDist, path)))) return
  // SPA fallback (portal BrowserRouter routes) — only when the portal build exists.
  const indexHtml = join(portalDist, 'index.html')
  if (
    await stat(indexHtml).then(
      () => true,
      () => false
    )
  ) {
    if (await serveFile(res, indexHtml)) return
  }
  res.statusCode = 404
  res.end('not found (build the portal harness with: pnpm --filter @attestrack/e2e build:portal-live)')
}).listen(PORT, () => {
  process.stderr.write(`e2e page server on ${PORT}\n`)
})
