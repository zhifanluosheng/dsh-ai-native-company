// 把「已接入数据」的样子演出来：给临时库塞两条快照、一条观测、一条待拍板决策和一个任务。
// 只用于开发预览，不写进 npm 包。
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const root = process.argv[2]
if (!root) throw new Error('usage: node seed-demo.mjs <root>')

const script = `
import { openCompanyDb, newId, appendAudit, seedSources } from './dsh/db.js'
const db = openCompanyDb(${JSON.stringify(root)})
seedSources(db)
const at = (daysAgo, hour = 9) => {
  const d = new Date(Date.now() - daysAgo * 864e5)
  d.setHours(hour, 5, 0, 0)
  return d.toISOString()
}
const source = 'douyin-main'
db.prepare("UPDATE sources SET last_success_at = ?, status = 'green' WHERE id = ?").run(at(1), source)
db.prepare("UPDATE sources SET last_success_at = ?, status = 'green' WHERE id = ?").run(at(1, 13), 'bilibili')
const rows = [
  [6, 1180], [5, 1390], [4, 1240], [3, 1620], [2, 1480], [1, 1710],
]
let previous = 0
for (const [daysAgo, count] of rows) {
  const id = newId('snap')
  db.prepare(\`INSERT INTO snapshots (id, source_id, captured_at, period_start, period_end, raw_path, sha256, row_count, quality_score, quality_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')\`).run(
    id, source, at(daysAgo), at(daysAgo), at(daysAgo).slice(0, 10), 'snapshots/demo.csv', newId('sha'), count + previous, 0.98,
  )
  previous = 0
}
db.prepare(\`INSERT INTO decisions (id, module_id, title, diagnosis, recommendation, risk_level, status, evidence_json, options_json, measure_json, created_at, updated_at)
  VALUES (?, 'content', ?, ?, ?, 'R2', ?, ?, '[]', ?, ?, ?)\`).run(
  newId('dec'), '抖音完播率连续 3 天下降 18%，40 秒以上的开头明显吃亏',
  '近 3 条 60 秒以上视频完播率 21%，同账号 30 秒内视频是 34%。',
  '先改 3 条视频的前 3 秒钩子，封面不动；72 小时后看 3 秒留存。',
  'pending',
  JSON.stringify([{ snapshotId: 'demo', metric: 'completion_rate', value: 0.21 }]),
  JSON.stringify({ metric: 'retention_3s', baseline: 0.41, target: 0.48, windowDays: 3 }),
  at(0, 8), at(0, 8),
)
// 一条「已拍板」的决策 + 正在跑的任务，用来演示闭环里的后半段。
db.prepare(\`INSERT INTO decisions (id, module_id, title, diagnosis, recommendation, risk_level, status, evidence_json, options_json, measure_json, created_at, updated_at, decided_at, decided_by)
  VALUES (?, 'content', ?, ?, ?, 'R1', 'approved', ?, '[]', ?, ?, ?, ?, ?)\`).run(
  newId('dec'), '小红书收藏率低于均值，先把封面文字砍一半',
  '近 5 篇笔记收藏率 2.1%，同赛道中位 3.4%。',
  '改 5 篇封面文案，正文不动。',
  JSON.stringify([{ snapshotId: 'demo', metric: 'save_rate', value: 0.021 }]),
  JSON.stringify({ metric: 'save_rate', baseline: 0.021, target: 0.03, windowDays: 7 }),
  at(1, 10), at(1, 10), at(1, 11), 'human',
)
const decision = db.prepare("SELECT id FROM decisions WHERE status = 'approved' LIMIT 1").get()
db.prepare(\`INSERT INTO tasks (id, decision_id, module_id, title, action_id, risk_level, status, measure_metric, baseline_value, target_value, created_at, updated_at)
  VALUES (?, ?, 'content', '改写 3 条视频开头钩子', 'rewrite-hook', 'R1', 'running', 'retention_3s', 0.41, 0.48, ?, ?)\`).run(
  newId('task'), decision.id, at(0, 9), at(0, 9),
)
appendAudit(db, { actor: 'human', action: 'import', entityType: 'source', entityId: source })
appendAudit(db, { actor: 'ceo-agent', action: 'brief.generate', entityType: 'brief', entityId: 'demo' })
console.log('seeded')
`

execFileSync(process.execPath, ['--input-type=module', '-e', script], { stdio: 'inherit', cwd: process.cwd() })
