// 客户端结构预览：在普通浏览器里用假的 __ModuleLoader__ / React 挂载 App，
// 只验证渲染结构、空态文案和接口连通，不替代 Desktop 内的真实验收。
import { mkdir, writeFile } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(process.argv[2] || '.')
const out = resolve(root, '.preview')
await mkdir(out, { recursive: true })

const client = await readFile(resolve(root, 'lib/client.js'), 'utf8')
const page = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>Agent New Media Studio · 结构预览</title>
<style>html,body{margin:0;height:100%;background:#0d1013}#host{width:100vw;height:100vh;display:flex}</style>
<script src="https://unpkg.com/react@18/umd/react.development.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
</head><body>
<div id="host"></div>
<script>
  window.__ModuleLoader__ = {
    load({ id, factory }) {
      const mod = factory((name) => {
        if (name === 'react') return React
        if (name === 'react-dom') return ReactDOM
        throw new Error('require(' + name + ') 不在预览基线里')
      })
      const ctx = {
        effect: (fn) => { fn() },
        desktopWorkbenches: {
          register(descriptor, Component) {
            window.__workbench = { descriptor, Component }
            return () => {}
          },
        },
        sessions: { scope: () => null },
      }
      mod.apply(ctx)
      const { descriptor, Component } = window.__workbench
      const service = {
        ctx,
        currentSession: () => null,
        ownsSession: () => false,
        defaultWorkspace: () => null,
        newSession: async () => null,
      }
      ReactDOM.createRoot(document.getElementById('host')).render(
        React.createElement(Component, { service, entry: descriptor, active: true, conversation: null })
      )
    },
  }
</script>
<script src="./client.js"></script>
</body></html>`

await writeFile(resolve(out, 'preview.html'), page)
await writeFile(resolve(out, 'client.js'), client)
console.log('preview written to .preview/preview.html')
