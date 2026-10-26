import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  appendAudit,
  countOf,
  freshnessOf,
  openCompanyDb,
  readSetting,
  SCHEMA_VERSION,
  seedSources,
  verifyAuditChain,
  writeSetting,
} from './db.js'
import { MODULES, MODULE_BY_ID, RISK_LABEL } from './modules.js'
import {
  API_HEADER,
  API_PREFIX,
  assertWritable,
  fail,
  isLoopback,
  publicError,
  queryOf,
  readJsonBody,
  sendJson,
} from './http.js'

export const name = 'dsh-agent-new-media-studio'
export const inject = ['webServer']
export const version = '0.1.1'

const DIAGNOSTIC = { expose: '工作台数据目录不可用，请查看 DSH 日志后重启。' }
// Desktop 宿主把这个前缀注册进 webServer；纯 Web 形态没有它。
const DESKTOP_ROUTE = '/api/desktop-workbenches/state'

/**
 * 数据目录优先级：cordis.patch.yml 的 config.root（dshHomePath）
 * → 环境变量（开发/测试）→ $DSH_HOME → ~/.dsh。不做任何其他路径推测。
 */
function resolveRoot(config) {
  if (typeof config?.root === 'string' && config.root.trim()) return config.root.trim()
  const override = process.env.DSH_AGENT_NEW_MEDIA_STUDIO_ROOT
  if (override && override.trim()) return override.trim()
  const home = process.env.DSH_HOME && process.env.DSH_HOME.trim()
  return join(home || join(homedir(), '.dsh'), 'agent-new-media-studio')
}

function moduleViews(db) {
  const sourceRows = db.prepare('SELECT * FROM sources').all()
  const pending = db.prepare("SELECT module_id, COUNT(*) AS n FROM decisions WHERE status = 'pending' GROUP BY module_id").all()
  const activeTasks = db.prepare(`
    SELECT module_id, COUNT(*) AS n FROM tasks
    WHERE status IN ('queued', 'running', 'blocked', 'submitted', 'verifying', 'verified', 'measuring')
    GROUP BY module_id
  `).all()
  const pendingMap = new Map(pending.map((row) => [row.module_id, Number(row.n)]))
  const taskMap = new Map(activeTasks.map((row) => [row.module_id, Number(row.n)]))
  const enabled = new Map(db.prepare('SELECT id, enabled FROM modules').all().map((row) => [row.id, Number(row.enabled) === 1]))

  return MODULES.map((module) => {
    const rows = sourceRows.filter((row) => row.module_id === module.id)
    const sources = rows.map((row) => {
      const fresh = freshnessOf(row)
      return {
        id: row.id,
        name: row.name,
        kind: row.kind,
        status: fresh.state,
        ageHours: fresh.ageHours,
        cadenceHours: Number(row.cadence_hours ?? 24),
        lastSuccessAt: row.last_success_at || null,
        lastError: row.last_error || null,
      }
    })
    const worst = ['red', 'yellow', 'green'].find((state) => sources.some((item) => item.status === state))
      || (sources.length ? 'unknown' : 'unknown')
    return {
      id: module.id,
      name: module.name,
      glyph: module.glyph,
      tagline: module.tagline,
      phase: module.phase,
      enabled: enabled.get(module.id) !== false,
      primaryMetric: module.primaryMetric,
      freshness: { state: worst, expectedEveryHours: module.freshness.expectedEveryHours },
      sources,
      pendingDecisions: pendingMap.get(module.id) ?? 0,
      activeTasks: taskMap.get(module.id) ?? 0,
      actions: module.actions.map((action) => ({ ...action, riskLabel: RISK_LABEL[action.risk] })),
    }
  })
}

function sourceViews(db) {
  const rows = db.prepare('SELECT * FROM sources ORDER BY module_id, name').all()
  return rows.map((row) => {
    const fresh = freshnessOf(row)
    const module = MODULE_BY_ID.get(row.module_id)
    return {
      id: row.id,
      moduleId: row.module_id,
      moduleName: module?.name ?? row.module_id,
      name: row.name,
      kind: row.kind,
      status: fresh.state,
      ageHours: fresh.ageHours,
      note: fresh.note ?? null,
      cadenceHours: Number(row.cadence_hours ?? 24),
      warnAfterHours: Number(row.warn_after_hours ?? 30),
      blockAfterHours: Number(row.block_after_hours ?? 72),
      lastSuccessAt: row.last_success_at || null,
      lastRunAt: row.last_run_at || null,
      lastError: row.last_error || null,
      snapshotCount: Number(db.prepare('SELECT COUNT(*) AS n FROM snapshots WHERE source_id = ?').get(row.id)?.n ?? 0),
    }
  })
}

function decisionViews(db, status) {
  const rows = status
    ? db.prepare('SELECT * FROM decisions WHERE status = ? ORDER BY created_at DESC LIMIT 100').all(status)
    : db.prepare('SELECT * FROM decisions ORDER BY created_at DESC LIMIT 100').all()
  return rows.map((row) => ({
    id: row.id,
    moduleId: row.module_id,
    moduleName: MODULE_BY_ID.get(row.module_id)?.name ?? row.module_id,
    title: row.title,
    diagnosis: row.diagnosis,
    riskLevel: row.risk_level,
    riskLabel: RISK_LABEL[row.risk_level] ?? row.risk_level,
    status: row.status,
    version: Number(row.version ?? 1),
    recommendation: row.recommendation,
    options: JSON.parse(row.options_json || '[]'),
    evidence: JSON.parse(row.evidence_json || '[]'),
    measure: JSON.parse(row.measure_json || '{}'),
    deadlineAt: row.deadline_at || null,
    evidenceValidUntil: row.evidence_valid_until || null,
    decidedAt: row.decided_at || null,
    decidedBy: row.decided_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

function taskViews(db, status) {
  const rows = status
    ? db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC LIMIT 100').all(status)
    : db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 100').all()
  return rows.map((row) => ({
    id: row.id,
    decisionId: row.decision_id,
    moduleId: row.module_id,
    moduleName: MODULE_BY_ID.get(row.module_id)?.name ?? row.module_id,
    title: row.title,
    actionId: row.action_id,
    riskLevel: row.risk_level,
    status: row.status,
    attempt: Number(row.attempt ?? 1),
    measureMetric: row.measure_metric,
    measureAt: row.measure_at || null,
    baselineValue: row.baseline_value,
    targetValue: row.target_value,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

/**
 * 近 14 天每天新增（快照相减），按模块分组。
 * 只算同一数据源连续两次快照之间的差值，且只在同一天内累计；没有快照的天返回 null（界面画空柱）。
 */
function dailyHistory(db) {
  const rows = db.prepare(`
    SELECT s.source_id AS source_id, src.module_id AS module_id, s.period_end AS period_end,
           s.row_count AS row_count, s.captured_at AS captured_at
    FROM snapshots s JOIN sources src ON src.id = s.source_id
    ORDER BY s.source_id ASC, s.captured_at ASC
  `).all()
  const out = {}
  const last = new Map()
  for (const row of rows) {
    const previous = last.get(row.source_id)
    last.set(row.source_id, row)
    if (!previous) continue
    const delta = Number(row.row_count) - Number(previous.row_count)
    if (!Number.isFinite(delta) || delta === 0) continue
    const day = String(row.period_end || row.captured_at).slice(0, 10)
    out[row.module_id] = out[row.module_id] || {}
    out[row.module_id][day] = (out[row.module_id][day] || 0) + delta
  }
  return out
}

function auditViews(db, limit) {
  const rows = db.prepare(`
    SELECT id, actor, action, entity_type, entity_id, detail_json, hash, prev_hash, created_at
    FROM audit_log ORDER BY created_at DESC, id DESC LIMIT ?
  `).all(limit)
  return {
    chain: verifyAuditChain(db),
    entries: rows.map((row) => ({
      id: row.id,
      actor: row.actor,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      detail: JSON.parse(row.detail_json || '{}'),
      hash: row.hash,
      prevHash: row.prev_hash,
      createdAt: row.created_at,
    })),
  }
}

/**
 * desktopWorkbenches 由 Desktop 宿主注入。在纯 Web 形态（`dsh --profile web`）下它不存在，
 * 此时插件保持 available 但不注册面板，宿主不会报 “pending (waiting for service)”。
 * 判定方式：注入 Desktop 自己 register 到 webServer 的路由前缀。
 */
function isDesktopHost(ctx, config) {
  if (config?.desktopHost === true) return true
  if (config?.desktopHost === false) return false
  try {
    const routes = ctx.webServer?.routes
    if (routes && typeof routes.has === 'function') return routes.has(DESKTOP_ROUTE)
  } catch { /* 路由表不可读时按 Web 形态处理 */ }
  return false
}

export const apply = applyPlugin

export function applyPlugin(ctx, config) {
  const root = resolveRoot(config)
  let db = null
  let bootError = null
  try {
    db = openCompanyDb(root)
    seedSources(db)
  } catch (error) {
    bootError = DIAGNOSTIC.expose
    ctx.logger?.error?.('[agent-new-media-studio] 打开数据库失败', error)
  }

  const requireDb = (res) => {
    if (db) return true
    fail(res, 503, 'DB_UNAVAILABLE', bootError || DIAGNOSTIC.expose)
    return false
  }

  const paused = () => Boolean(db && readSetting(db, 'paused', false))

  const latestBrief = () => {
    const row = db.prepare('SELECT id, brief_date, version, summary, created_at FROM briefs ORDER BY created_at DESC LIMIT 1').get()
    if (!row) return null
    return {
      id: row.id,
      date: row.brief_date,
      version: Number(row.version),
      summary: row.summary,
      createdAt: row.created_at,
    }
  }

  const bootstrapPayload = () => {
    const modules = moduleViews(db)
    const sources = sourceViews(db)
    const audit = verifyAuditChain(db)
    return {
      ok: true,
      plugin: { name, version, schemaVersion: SCHEMA_VERSION },
      paused: paused(),
      dataStatus: {
        total: sources.length,
        green: sources.filter((item) => item.status === 'green').length,
        yellow: sources.filter((item) => item.status === 'yellow').length,
        red: sources.filter((item) => item.status === 'red').length,
        unknown: sources.filter((item) => item.status === 'unknown').length,
      },
      counts: {
        snapshots: countOf(db, 'snapshots'),
        decisionsPending: Number(db.prepare("SELECT COUNT(*) AS n FROM decisions WHERE status = 'pending'").get()?.n ?? 0),
        decisionsTotal: countOf(db, 'decisions'),
        tasksActive: Number(db.prepare(`
          SELECT COUNT(*) AS n FROM tasks
          WHERE status IN ('queued', 'running', 'blocked', 'submitted', 'verifying', 'verified', 'measuring')
        `).get()?.n ?? 0),
        tasksTotal: countOf(db, 'tasks'),
        observationsOpen: Number(db.prepare("SELECT COUNT(*) AS n FROM observations WHERE status = 'open'").get()?.n ?? 0),
        docs: countOf(db, 'knowledge_docs'),
        auditEntries: countOf(db, 'audit_log'),
      },
      health: { db: 'ready', audit },
      brief: latestBrief(),
      modules,
      history: dailyHistory(db),
      serverTime: new Date().toISOString(),
    }
  }

  /** 今日概览：顶部数字 + 简报，供界面定时轻量刷新。 */
  const todayPayload = () => ({
    ok: true,
    paused: paused(),
    counts: {
      decisionsPending: Number(db.prepare("SELECT COUNT(*) AS n FROM decisions WHERE status = 'pending'").get()?.n ?? 0),
      tasksActive: Number(db.prepare(`
        SELECT COUNT(*) AS n FROM tasks
        WHERE status IN ('queued', 'running', 'blocked', 'submitted', 'verifying', 'verified', 'measuring')
      `).get()?.n ?? 0),
      snapshots: countOf(db, 'snapshots'),
      tasksClosed: Number(db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status = 'closed'").get()?.n ?? 0),
    },
    dataStatus: (() => {
      const sources = sourceViews(db)
      return {
        total: sources.length,
        green: sources.filter((item) => item.status === 'green').length,
        yellow: sources.filter((item) => item.status === 'yellow').length,
        red: sources.filter((item) => item.status === 'red').length,
        unknown: sources.filter((item) => item.status === 'unknown').length,
      }
    })(),
    brief: latestBrief(),
    serverTime: new Date().toISOString(),
  })

  /** 单个模块详情：数据源、近 14 天、观测、决策、任务。 */
  const detailPayload = (moduleId) => {
    const module = MODULE_BY_ID.get(moduleId)
    if (!module) return { ok: false, error: { code: 'MODULE_UNKNOWN', message: '没有这个模块' } }
    const sources = sourceViews(db).filter((item) => item.moduleId === moduleId)
    const observations = db.prepare(`
      SELECT id, kind, severity, title, detail, confidence, status, detected_at
      FROM observations WHERE module_id = ? ORDER BY detected_at DESC LIMIT 12
    `).all(moduleId).map((row) => ({
      id: row.id,
      kind: row.kind,
      severity: row.severity,
      title: row.title,
      detail: row.detail,
      confidence: row.confidence,
      status: row.status,
      detectedAt: row.detected_at,
    }))
    const decisions = decisionViews(db).filter((item) => item.moduleId === moduleId)
    const tasks = taskViews(db).filter((item) => item.moduleId === moduleId)
    return {
      ok: true,
      module: moduleViews(db).find((item) => item.id === moduleId),
      sources,
      history: dailyHistory(db)[moduleId] || {},
      observations,
      decisions,
      tasks,
      serverTime: new Date().toISOString(),
    }
  }

  const handle = async (req, res) => {
    if (!isLoopback(req)) return fail(res, 403, 'NOT_LOOPBACK', '只允许本机访问')
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const path = url.pathname.startsWith(API_PREFIX) ? url.pathname.slice(API_PREFIX.length) || '/' : null
    if (path === null) return fail(res, 404, 'NOT_FOUND', '未知接口')

    if (req.method === 'GET') {
      if (path === '/health') {
        return sendJson(res, 200, {
          ok: !bootError,
          plugin: { name, version, schemaVersion: SCHEMA_VERSION },
          db: db ? 'ready' : 'unavailable',
          error: bootError,
        })
      }
      if (!requireDb(res)) return
      if (path === '/bootstrap') return sendJson(res, 200, bootstrapPayload())
      if (path === '/today') return sendJson(res, 200, todayPayload())
      const detailMatch = path.match(/^\/detail\/([a-z0-9-]+)$/)
      if (detailMatch) return sendJson(res, 200, detailPayload(detailMatch[1]))
      if (path === '/modules') return sendJson(res, 200, { ok: true, modules: moduleViews(db) })
      if (path === '/sources') return sendJson(res, 200, { ok: true, sources: sourceViews(db) })
      if (path === '/decisions') return sendJson(res, 200, { ok: true, decisions: decisionViews(db, queryOf(req).get('status')) })
      if (path === '/tasks') return sendJson(res, 200, { ok: true, tasks: taskViews(db, queryOf(req).get('status')) })
      if (path === '/audit') {
        const limit = Math.min(Math.max(Number(queryOf(req).get('limit')) || 50, 1), 500)
        return sendJson(res, 200, { ok: true, ...auditViews(db, limit) })
      }
      return fail(res, 404, 'NOT_FOUND', '未知接口')
    }

    if (req.method === 'POST') {
      const writable = assertWritable(req)
      if (!writable.ok) return fail(res, writable.status, writable.code, writable.message)
      if (!requireDb(res)) return
      let body
      try {
        body = await readJsonBody(req)
      } catch (error) {
        return fail(res, error.status || 400, error.code || 'INVALID_BODY', error.message || '请求无效')
      }

      if (path === '/settings/pause') {
        const next = Boolean(body.paused)
        const before = paused()
        db.exec('BEGIN')
        try {
          writeSetting(db, 'paused', next)
          appendAudit(db, {
            actor: 'human',
            action: next ? 'pause' : 'resume',
            entityType: 'setting',
            entityId: 'paused',
            beforeHash: String(before),
            afterHash: String(next),
          })
          db.exec('COMMIT')
        } catch (error) {
          db.exec('ROLLBACK')
          ctx.logger?.error?.('[agent-new-media-studio] 切换暂停失败', error)
          return fail(res, 500, 'WRITE_FAILED', '写入失败，未产生任何变更')
        }
        return sendJson(res, 200, { ok: true, paused: next })
      }

      return fail(res, 404, 'NOT_FOUND', '未知接口')
    }

    return fail(res, 405, 'METHOD_NOT_ALLOWED', '不支持的方法')
  }

  // 纯 Web 形态：服务端照常提供本机 API，但客户端不注册面板。
  ctx.effect(() => {
    if (isDesktopHost(ctx, config)) return undefined
    ctx.logger?.info?.('[agent-new-media-studio] 当前是纯 Web 形态（没有 Desktop 工作台宿主），API 可用，面板不注册。')
    return undefined
  }, 'agent-new-media-studio: host check')

  const routes = [
    '/health', '/bootstrap', '/today', '/modules', '/sources', '/decisions', '/tasks', '/audit', '/settings/pause',
  ]
  for (const path of routes) {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: `${API_PREFIX}${path}`,
      handler: (req, res) => {
        res.setHeader('X-Agent-New-Media-Studio', '1')
        handle(req, res).catch((error) => {
          ctx.logger?.error?.('[agent-new-media-studio] 请求失败', error)
          try {
            fail(res, 500, 'INTERNAL', publicError(error).message)
          } catch { /* 响应已结束 */ }
        })
      },
    }), `agent-new-media-studio: ${path}`)
  }

  // /detail/<moduleId>：路径带变量，用 prefix 路由；其余仍在 handle 里按精确路径分派。
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: `${API_PREFIX}/detail`,
    handler: (req, res) => {
      res.setHeader('X-Agent-New-Media-Studio', '1')
      handle(req, res).catch((error) => {
        ctx.logger?.error?.('[agent-new-media-studio] 请求失败', error)
        try {
          fail(res, 500, 'INTERNAL', publicError(error).message)
        } catch { /* 响应已结束 */ }
      })
    },
  }), 'agent-new-media-studio: /detail')

  ctx.effect(() => () => {
    try {
      db?.close()
    } catch { /* 关闭失败不影响卸载 */ }
    db = null
  }, 'agent-new-media-studio: db')

  ctx.logger?.info?.(`[agent-new-media-studio] v${version} · 数据目录 ${root} · ${bootError ? '数据库不可用' : '就绪'}`)
}
