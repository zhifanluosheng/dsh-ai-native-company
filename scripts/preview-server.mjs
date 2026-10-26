// 预览用的小代理：静态托管 .preview，并在同源下转发工作台 API，
// 让浏览器预览能真实读到本机插件接口（只用于开发自检，不进 npm 包）。
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve } from 'node:path'

const dir = resolve(process.argv[2] || '.preview')
const upstream = process.env.UPSTREAM || 'http://127.0.0.1:4399'
const port = Number(process.env.PREVIEW_PORT || 4400)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  if (url.pathname.startsWith('/api/agent-new-media-studio')) {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = chunks.length ? Buffer.concat(chunks) : undefined
    const headers = { ...req.headers, host: '127.0.0.1' }
    delete headers['accept-encoding']
    try {
      const upstreamRes = await fetch(`${upstream}${url.pathname}${url.search}`, {
        method: req.method,
        headers,
        body,
      })
      const buffer = Buffer.from(await upstreamRes.arrayBuffer())
      res.writeHead(upstreamRes.status, {
        'content-type': upstreamRes.headers.get('content-type') || 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(buffer)
    } catch (error) {
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: { code: 'UPSTREAM_DOWN', message: String(error?.message || error) } }))
    }
    return
  }

  const target = join(dir, url.pathname === '/' ? 'preview.html' : url.pathname)
  if (!existsSync(target) || !statSync(target).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
    return
  }
  res.writeHead(200, { 'content-type': MIME[extname(target)] || 'application/octet-stream', 'cache-control': 'no-store' })
  createReadStream(target).pipe(res)
}).listen(port, '127.0.0.1', () => {
  console.log(`[preview] http://127.0.0.1:${port}/preview.html  (API → ${upstream})`)
})
