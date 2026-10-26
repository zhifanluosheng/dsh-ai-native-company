import { mkdir, readFile, writeFile } from 'node:fs/promises'
import vm from 'node:vm'

const root = new URL('../', import.meta.url)
const sourcePath = new URL('src/client.js', root)
const outputPath = new URL('lib/client.js', root)
const checkOnly = process.argv.includes('--check')

const raw = await readFile(sourcePath, 'utf8')

// 客户端必须是单文件模块：只能通过模块加载器注册，不能有裸模块 import。
if (!raw.includes('window.__ModuleLoader__.load(')) throw new Error('客户端缺少 window.__ModuleLoader__.load(...) 注册')
if (/^\s*import\s.+from\s+['"]/m.test(raw)) throw new Error('客户端不能有顶层 import；共享模块请用 factory 的 require')
if (/^\s*export\s/m.test(raw)) throw new Error('客户端不能有顶层 export')
if (raw.includes('REPOSITORY = \'https://github.com/<')) throw new Error('repository 不能是占位符')

// 语法检查（不执行）：能捕获拼写、括号、模板字符串错误。
new vm.Script(raw, { filename: 'src/client.js' })

const banner = '/* Built single-file module · 源码在 src/client.js，由 scripts/build-client.mjs 生成，请勿直接改这个文件。 */\n'
const output = banner + raw

if (!checkOnly) {
  await mkdir(new URL('lib/', root), { recursive: true })
  await writeFile(outputPath, output)
  console.log(`built lib/client.js (${(Buffer.byteLength(output) / 1024).toFixed(1)} KiB)`)
} else {
  const existing = await readFile(outputPath, 'utf8').catch(() => '')
  if (existing !== output) throw new Error('lib/client.js 与 src/client.js 不一致，请运行 npm run build')
  console.log('client build is up to date')
}
