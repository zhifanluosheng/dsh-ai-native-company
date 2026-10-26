import { readFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = async (rel) => readFile(resolve(root, rel), 'utf8')
const exists = async (rel) => {
  try {
    await stat(resolve(root, rel))
    return true
  } catch {
    return false
  }
}

const problems = []
const fail = (message) => problems.push(message)

const pkg = JSON.parse(await read('package.json'))

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) fail('version 必须是完整 SemVer')
if (pkg.type !== 'module') fail('必须声明 "type": "module"')
if (!pkg.dsh?.bundle?.patch) fail('缺少 dsh.bundle.patch')
if (pkg.dsh?.client?.platform !== 'web') fail('dsh.client.platform 必须是 "web"')
if (!Array.isArray(pkg.dsh?.client?.inject) || !pkg.dsh.client.inject.includes('dsh-desktop-workbenches')) {
  fail('dsh.client.inject 必须包含 dsh-desktop-workbenches')
}
if (!pkg.repository?.url) fail('缺少 repository，工作台身份需要它')
if (pkg.repository?.url?.startsWith('git+https://github.com/')) {
  fail('repository 必须与工作台身份一致，否则市场卡片、侧栏和会话归属会对不上（详见 README 的「身份」说明）')
}
if (!pkg.exports?.['./client']) fail('缺少 exports["./client"]')

for (const target of new Set([pkg.main, pkg.exports?.['.'], pkg.exports?.['./client'], pkg.exports?.['./cordis.patch.yml'], pkg.dsh?.bundle?.patch])) {
  if (!target) continue
  if (!(await exists(target))) fail(`入口文件不存在：${target}`)
}

const patch = await read('cordis.patch.yml')
if (/^\s*\[\s*\]\s*$/m.test(patch)) fail('cordis.patch.yml 不能是空数组')
const patchName = patch.match(/^\s*name:\s*(\S+?)\s*(?:#.*)?$/m)?.[1]
if (patchName !== pkg.name) fail(`cordis.patch.yml 的 name 必须是包名（现在是 ${patchName || '缺失'}）`)
if (/insert:[\s\S]*?path:/.test(patch)) fail('patch 里不应写相对路径，name 必须写包名')

const client = await read('lib/client.js')
if (!client.includes(`id: '${pkg.name}'`)) fail('lib/client.js 的模块 id 必须与包名一致')
if (!client.includes('window.__ModuleLoader__.load(')) fail('lib/client.js 缺少模块加载器注册')
if (client.includes('https://github.com/<')) fail('客户端 repository 不能是占位符')

const source = await read('src/client.js')
if (source !== client.replace(/^\/\*[^\n]*\*\/\n/, '')) fail('lib/client.js 不是 src/client.js 的最新构建，请运行 npm run build')

for (const file of pkg.files || []) {
  if (!(await exists(file))) fail(`files 里声明的路径不存在：${file}`)
}

const size = Buffer.byteLength(client)
if (size > 512 * 1024) fail(`客户端产物 ${(size / 1024).toFixed(0)} KiB，超过 512 KiB 上限`)

const forbidden = [/\bsk-[A-Za-z0-9]{16,}/, /ghp_[A-Za-z0-9]{20,}/, /[A-Za-z]:[\\/]Users[\\/]/i]
for (const pattern of forbidden) {
  if (pattern.test(patch) || pattern.test(client)) fail(`包内容疑似包含敏感信息：${pattern}`)
}

if (problems.length) {
  console.error('包校验失败：')
  for (const problem of problems) console.error(` - ${problem}`)
  process.exit(1)
}

console.log(`包校验通过：${pkg.name}@${pkg.version} · 客户端 ${(size / 1024).toFixed(1)} KiB`)
