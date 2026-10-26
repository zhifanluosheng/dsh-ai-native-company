// 本机开发/预览用的小服务：把插件挂在一个假的 ctx 上，只暴露工作台自己的 API。
// 这不是工作台的一部分（不进 npm 包），只用于在没有 Desktop 的机器上验证接口。
import { createServer } from 'node:http'
import { join } from 'node:path'
import { apply } from '../dsh/index.js'

const root = process.env.DSH_AGENT_NEW_MEDIA_STUDIO_ROOT || join(process.cwd(), '.dev-data')
const routes = new Map()

const ctx = {
  logger: console,
  effect(factory) {
    const dispose = factory()
    return typeof dispose === 'function' ? dispose : undefined
  },
  webServer: {
    register(route) {
      routes.set(route.path, route.handler)
      return () => routes.delete(route.path)
    },
  },
}

apply(ctx, { root })

const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname
  const handler = routes.get(path)
  if (!handler) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'no route' } }))
    return
  }
  handler(req, res)
})

const port = Number(process.env.PORT || 4399)
server.listen(port, '127.0.0.1', () => {
  console.log(`[dev] Agent New Media Studio API → http://127.0.0.1:${port}/api/agent-new-media-studio/health`)
  console.log(`[dev] 数据目录：${root}`)
})
