import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { appendAudit, countOf, freshnessOf, openCompanyDb, verifyAuditChain } from '../dsh/db.js'
import { API_HEADER, API_PREFIX } from '../dsh/http.js'
import { apply } from '../dsh/index.js'

function fakeCtx() {
  const routes = new Map()
  const cleanups = []
  return {
    routes,
    logger: { info() {}, error() {} },
    effect(factory) {
      const dispose = factory()
      if (typeof dispose === 'function') cleanups.push(dispose)
    },
    webServer: {
      register(route) {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
    dispose() {
      for (const cleanup of cleanups.reverse()) cleanup()
    },
  }
}

function request(handler, { method = 'GET', path = '/health', headers = {}, body } = {}) {
  const req = new EventEmitter()
  req.method = method
  req.url = `${API_PREFIX}${path}`
  req.headers = { ...headers }
  req.socket = { remoteAddress: '127.0.0.1' }
  const res = {
    statusCode: 0,
    headers: {},
    payload: '',
    setHeader() {},
    writeHead(code, extra) {
      this.statusCode = code
      Object.assign(this.headers, extra || {})
    },
    end(chunk) {
      this.payload = String(chunk ?? '')
      this.done?.()
    },
  }
  const finished = new Promise((resolve) => { res.done = resolve })
  handler(req, res)
  setImmediate(() => {
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  })
  return finished.then(() => ({ status: res.statusCode, headers: res.headers, json: res.payload ? JSON.parse(res.payload) : null }))
}

test('数据库初始化：建表、种模块、空库自检', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ans-db-'))
  const db = openCompanyDb(dir)
  try {
    assert.equal(countOf(db, 'modules'), 6)
    assert.equal(countOf(db, 'snapshots'), 0)
    assert.equal(countOf(db, 'decisions'), 0)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name)
    for (const table of ['audit_log', 'decisions', 'metrics', 'snapshots', 'tasks', 'knowledge_fts']) {
      assert.ok(tables.includes(table), `缺少表 ${table}`)
    }
    // FTS5 可用性：写入后能搜到中文
    db.prepare('INSERT INTO knowledge_docs (id, module_id, title, body, tags_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
      .run('k1', 'content', '第一批复盘', '完播率下降的两个原因', '[]', new Date().toISOString(), new Date().toISOString())
    const hit = db.prepare("SELECT title FROM knowledge_fts WHERE knowledge_fts MATCH '完播率'").all()
    assert.equal(hit.length, 1)
  } finally {
    db.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('任务必须先有已批准的决策（数据库层硬约束）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ans-task-'))
  const db = openCompanyDb(dir)
  try {
    const at = new Date().toISOString()
    db.prepare('INSERT INTO decisions (id, module_id, title, status, created_at, updated_at) VALUES (?,?,?,?,?,?)')
      .run('d1', 'content', '待批决策', 'pending', at, at)
    assert.throws(() => {
      db.prepare('INSERT INTO tasks (id, decision_id, module_id, title, action_id, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .run('t1', 'd1', 'content', '任务', 'rewrite-hook', 'queued', at, at)
    }, /task requires an approved decision/)
    db.prepare("UPDATE decisions SET status = 'approved' WHERE id = 'd1'").run()
    db.prepare('INSERT INTO tasks (id, decision_id, module_id, title, action_id, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run('t1', 'd1', 'content', '任务', 'rewrite-hook', 'queued', at, at)
    assert.equal(countOf(db, 'tasks'), 1)
  } finally {
    db.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('审计链：追加可校验，篡改会断链', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ans-audit-'))
  const db = openCompanyDb(dir)
  try {
    appendAudit(db, { actor: 'human', action: 'pause', entityType: 'setting', entityId: 'paused' })
    appendAudit(db, { actor: 'human', action: 'resume', entityType: 'setting', entityId: 'paused' })
    const ok = verifyAuditChain(db)
    assert.equal(ok.ok, true)
    assert.equal(ok.checked, 2)
    db.prepare("UPDATE audit_log SET detail_json = '{\"tampered\":true}' WHERE action = 'pause'").run()
    const broken = verifyAuditChain(db)
    assert.equal(broken.ok, false)
    assert.ok(broken.brokenAt)
  } finally {
    db.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('数据新鲜度：未知 / 绿 / 黄 / 红', () => {
  const source = { warn_after_hours: 30, block_after_hours: 72 }
  assert.equal(freshnessOf(source).state, 'unknown')
  const at = Date.now()
  const ago = (hours) => new Date(at - hours * 36e5).toISOString()
  assert.equal(freshnessOf({ ...source, last_success_at: ago(2) }, at).state, 'green')
  assert.equal(freshnessOf({ ...source, last_success_at: ago(40) }, at).state, 'yellow')
  assert.equal(freshnessOf({ ...source, last_success_at: ago(100) }, at).state, 'red')
})

test('本机 API：健康检查、引导数据、写操作头校验、暂停落审计', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ans-api-'))
  const ctx = fakeCtx()
  apply(ctx, { root: dir })
  try {
    const health = await request(ctx.routes.get(`${API_PREFIX}/health`))
    assert.equal(health.status, 200)
    assert.equal(health.json.ok, true)
    assert.equal(health.json.db, 'ready')
    assert.equal(health.headers['Cache-Control'], 'no-store')

    const bootstrap = await request(ctx.routes.get(`${API_PREFIX}/bootstrap`), { path: '/bootstrap' })
    assert.equal(bootstrap.status, 200)
    assert.equal(bootstrap.json.modules.length, 6)
    assert.equal(bootstrap.json.paused, false)
    assert.equal(bootstrap.json.counts.snapshots, 0)
    assert.equal(bootstrap.json.health.audit.ok, true)
    assert.equal(bootstrap.json.dataStatus.total, 6)
    assert.equal(bootstrap.json.dataStatus.unknown, 6)

    const denied = await request(ctx.routes.get(`${API_PREFIX}/settings/pause`), {
      method: 'POST',
      path: '/settings/pause',
      headers: { 'content-type': 'application/json' },
      body: { paused: true },
    })
    assert.equal(denied.status, 403)
    assert.equal(denied.json.error.code, 'MISSING_REQUEST_HEADER')

    const ok = await request(ctx.routes.get(`${API_PREFIX}/settings/pause`), {
      method: 'POST',
      path: '/settings/pause',
      headers: { 'content-type': 'application/json', [API_HEADER]: '1' },
      body: { paused: true },
    })
    assert.equal(ok.status, 200)
    assert.equal(ok.json.paused, true)

    const after = await request(ctx.routes.get(`${API_PREFIX}/bootstrap`), { path: '/bootstrap' })
    assert.equal(after.json.paused, true)
    assert.equal(after.json.counts.auditEntries, 1)
    assert.equal(after.json.health.audit.ok, true)

    const audit = await request(ctx.routes.get(`${API_PREFIX}/audit`), { path: '/audit?limit=10' })
    assert.equal(audit.status, 200)
    assert.equal(audit.json.entries[0].action, 'pause')
    assert.equal(audit.json.chain.ok, true)
  } finally {
    ctx.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('模块详情与今日接口：未知模块给明确错误，已知模块返回完整字段', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ans-detail-'))
  const ctx = fakeCtx()
  apply(ctx, { root: dir })
  try {
    const detail = ctx.routes.get(`${API_PREFIX}/detail`)
    assert.ok(detail, '缺少 /detail prefix 路由')
    const ok = await request(detail, { path: '/detail/content' })
    assert.equal(ok.status, 200)
    assert.equal(ok.json.ok, true)
    assert.equal(ok.json.module.id, 'content')
    for (const key of ['sources', 'history', 'observations', 'decisions', 'tasks']) {
      assert.ok(key in ok.json, `详情缺少字段 ${key}`)
    }
    assert.equal(ok.json.sources.length, 3)

    const bad = await request(detail, { path: '/detail/not-a-module' })
    assert.equal(bad.json.ok, false)
    assert.equal(bad.json.error.code, 'MODULE_UNKNOWN')

    const boot = await request(ctx.routes.get(`${API_PREFIX}/bootstrap`), { path: '/bootstrap' })
    assert.ok('history' in boot.json)
    assert.ok('brief' in boot.json)

    const today = await request(ctx.routes.get(`${API_PREFIX}/today`), { path: '/today' })
    assert.equal(today.status, 200)
    assert.equal(today.json.ok, true)
    assert.ok('brief' in today.json)
    assert.equal(today.json.counts.snapshots, 0)
  } finally {
    ctx.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('非回环请求一律拒绝', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ans-loop-'))
  const ctx = fakeCtx()
  apply(ctx, { root: dir })
  try {
    const handler = ctx.routes.get(`${API_PREFIX}/health`)
    const req = new EventEmitter()
    req.method = 'GET'
    req.url = `${API_PREFIX}/health`
    req.headers = {}
    req.socket = { remoteAddress: '10.0.0.7' }
    const res = { statusCode: 0, payload: '', setHeader() {}, writeHead(code) { this.statusCode = code }, end(chunk) { this.payload = String(chunk) } }
    await handler(req, res)
    assert.equal(res.statusCode, 403)
    assert.match(res.payload, /NOT_LOOPBACK/)
  } finally {
    ctx.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})
