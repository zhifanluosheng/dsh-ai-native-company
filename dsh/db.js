import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { MODULES } from './modules.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCHEMA_PATH = join(HERE, 'schema.sql')
export const SCHEMA_VERSION = 1

export const nowIso = () => new Date().toISOString()
export const newId = (prefix) => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 20)}`

/**
 * 稳定序列化：键排序后输出，保证同一事件每次算出同一个哈希。
 * 只接受 JSON 可序列化的值；非有限数字按 null 处理，避免 NaN 破坏哈希。
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return 'null'
    return JSON.stringify(value ?? null)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

export const sha256 = (input) => createHash('sha256').update(input).digest('hex')

/** 打开数据库并运行迁移。目录不存在时创建，除此之外不做任何隐式路径推断。 */
export function openCompanyDb(root) {
  mkdirSync(root, { recursive: true })
  mkdirSync(join(root, 'snapshots'), { recursive: true })
  mkdirSync(join(root, 'audit'), { recursive: true })
  const db = new DatabaseSync(join(root, 'company.db'))
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  migrate(db)
  return db
}

export function migrate(db) {
  const current = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0)
  if (current >= SCHEMA_VERSION) {
    seedModules(db)
    return
  }
  const schema = readFileSync(SCHEMA_PATH, 'utf8')
  db.exec('BEGIN')
  try {
    db.exec(schema)
    seedModules(db)
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** 模块目录以代码为准：数据库只记录启用状态和配置，不复制 descriptor。 */
function seedModules(db) {
  const upsert = db.prepare(`
    INSERT INTO modules (id, name, enabled, phase, config_json, created_at)
    VALUES (?, ?, 1, ?, '{}', ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, phase = excluded.phase
  `)
  const at = nowIso()
  for (const item of MODULES) upsert.run(item.id, item.name, item.phase, at)
}

export function seedSources(db) {
  const upsert = db.prepare(`
    INSERT INTO sources (id, module_id, name, kind, cadence_hours, warn_after_hours, block_after_hours, config_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, '{}')
    ON CONFLICT(id) DO NOTHING
  `)
  for (const module of MODULES) {
    for (const source of module.sources || []) {
      upsert.run(
        source.id,
        module.id,
        source.name,
        source.kind,
        module.freshness?.expectedEveryHours ?? 24,
        module.freshness?.warnAfterHours ?? 30,
        module.freshness?.blockAfterHours ?? 72,
      )
    }
  }
}

/** 追加一条审计事件，串成哈希链。调用方负责事务边界。 */
export function appendAudit(db, event) {
  const previous = db.prepare('SELECT hash FROM audit_log ORDER BY created_at DESC, id DESC LIMIT 1').get()
  const prevHash = previous?.hash ?? null
  const payload = {
    actor: event.actor,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    beforeHash: event.beforeHash ?? null,
    afterHash: event.afterHash ?? null,
    detail: event.detail ?? {},
    createdAt: event.createdAt ?? nowIso(),
  }
  const hash = sha256(`${prevHash ?? ''}${canonicalJson(payload)}`)
  const row = {
    id: newId('aud'),
    actor: payload.actor,
    action: payload.action,
    entity_type: payload.entityType,
    entity_id: payload.entityId,
    before_hash: payload.beforeHash,
    after_hash: payload.afterHash,
    detail_json: canonicalJson(payload.detail),
    prev_hash: prevHash,
    hash,
    created_at: payload.createdAt,
  }
  db.prepare(`
    INSERT INTO audit_log (id, actor, action, entity_type, entity_id, before_hash, after_hash, detail_json, prev_hash, hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id, row.actor, row.action, row.entity_type, row.entity_id,
    row.before_hash, row.after_hash, row.detail_json, row.prev_hash, row.hash, row.created_at,
  )
  return row
}

/** 重新计算整条链，返回第一个断裂点。没有事件时视为完好。 */
export function verifyAuditChain(db, limit = 5000) {
  const rows = db.prepare(`
    SELECT id, actor, action, entity_type, entity_id, before_hash, after_hash, detail_json, prev_hash, hash, created_at
    FROM audit_log ORDER BY created_at ASC, id ASC LIMIT ?
  `).all(limit)
  let prevHash = null
  for (const row of rows) {
    const payload = {
      actor: row.actor,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      beforeHash: row.before_hash ?? null,
      afterHash: row.after_hash ?? null,
      detail: JSON.parse(row.detail_json || '{}'),
      createdAt: row.created_at,
    }
    const expected = sha256(`${prevHash ?? ''}${canonicalJson(payload)}`)
    if (expected !== row.hash || (row.prev_hash ?? null) !== prevHash) {
      return { ok: false, brokenAt: row.id, checked: rows.length }
    }
    prevHash = row.hash
  }
  return { ok: true, checked: rows.length, head: prevHash }
}

export function readSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key)
  if (!row) return fallback
  try {
    return JSON.parse(row.value_json)
  } catch {
    return fallback
  }
}

export function writeSetting(db, key, value) {
  const at = nowIso()
  db.prepare(`
    INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run(key, canonicalJson(value), at)
  return { key, value, updatedAt: at }
}

/** 数据新鲜度：只根据真实同步时间判断，不做“看起来还行”的推断。 */
export function freshnessOf(source, at = Date.now()) {
  if (!source.last_success_at) return { state: 'unknown', ageHours: null, note: '还没有成功同步' }
  const ageHours = Math.max(0, (at - Date.parse(source.last_success_at)) / 36e5)
  const warn = source.warn_after_hours ?? 30
  const block = source.block_after_hours ?? 72
  const state = ageHours > block ? 'red' : ageHours > warn ? 'yellow' : 'green'
  return { state, ageHours: Number(ageHours.toFixed(1)) }
}

export function countOf(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ?? 0)
}
