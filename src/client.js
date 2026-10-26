// Agent New Media Studio · 客户端入口（构建为 lib/client.js 的单文件模块）
//
// 视觉形态对齐参考视频：顶栏 7 个 Tab + 创始人 → CEO → 6 路 Agent 的树状拓扑，
// 模块色贯通连线与子卡，黄灯 = 数据旧了、红灯 = 阻断、灰灯 = 还没接数据。
// 契约：通过 desktopWorkbenches.register() 注册业务面板；原生会话只放进右侧抽屉，
// 只预填草稿，由用户发送。

window.__ModuleLoader__.load({
  id: 'dsh-agent-new-media-studio',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const REPOSITORY = 'https://github.com/zhifanluosheng/dsh-ai-native-company'
    const API = '/api/agent-new-media-studio'
    const REQUEST_HEADER = 'x-agent-new-media-studio-request'
    const TZ = 'Asia/Shanghai'

    // ── 数据访问 ─────────────────────────────────────────────

    async function api(path, options = {}) {
      const method = options.method || 'GET'
      const headers = { accept: 'application/json' }
      if (options.body !== undefined) headers['content-type'] = 'application/json'
      if (method !== 'GET') headers[REQUEST_HEADER] = '1'
      const response = await fetch(`${API}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        cache: 'no-store',
        credentials: 'same-origin',
      })
      let payload = {}
      try {
        payload = await response.json()
      } catch { /* 空响应按失败处理 */ }
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error?.message || `请求失败（${response.status}）`)
      }
      return payload
    }

    function useBootstrap() {
      const [state, setState] = React.useState({ loading: true, data: null, error: null })
      const load = React.useCallback(async () => {
        try {
          const data = await api('/bootstrap')
          setState({ loading: false, data, error: null })
        } catch (error) {
          setState((prev) => ({ loading: false, data: prev.data, error: error.message }))
        }
      }, [])
      React.useEffect(() => {
        load()
        const timer = setInterval(load, 60000)
        return () => clearInterval(timer)
      }, [load])
      return { ...state, reload: load }
    }

    function useTick(intervalMs = 30000) {
      const [now, setNow] = React.useState(() => Date.now())
      React.useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), intervalMs)
        return () => clearInterval(timer)
      }, [intervalMs])
      return now
    }

    // ── 格式化 ───────────────────────────────────────────────

    const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
    const PLAIN = new Intl.NumberFormat('zh-CN')

    function compact(value) {
      const n = Number(value || 0)
      if (!Number.isFinite(n)) return '—'
      if (Math.abs(n) < 10000) return PLAIN.format(Math.round(n))
      return COMPACT.format(n).replace('K', 'k').replace('M', 'm')
    }

    function money(value) {
      const n = Number(value || 0)
      const tail = Math.abs(n) >= 1000 ? compact(n).replace(/k$/, 'k') : PLAIN.format(Math.round(n))
      return `¥${tail}`
    }

    function timeHM(iso) {
      if (!iso) return '—'
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return '—'
      return d.toLocaleTimeString('zh-CN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
    }

    function dateMD(iso) {
      if (!iso) return '—'
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return '—'
      return d.toLocaleDateString('zh-CN', { timeZone: TZ, month: '2-digit', day: '2-digit' })
    }

    function ago(iso) {
      if (!iso) return '还没有'
      const diff = Date.now() - Date.parse(iso)
      if (!Number.isFinite(diff)) return '—'
      const minutes = Math.round(diff / 60000)
      if (minutes < 1) return '刚刚'
      if (minutes < 60) return `${minutes} 分钟前`
      const hours = Math.round(minutes / 60)
      if (hours < 24) return `${hours} 小时前`
      return `${Math.round(hours / 24)} 天前`
    }

    function clockText(now) {
      return new Date(now).toLocaleTimeString('zh-CN', {
        timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      })
    }

    const TONE = { green: 'ok', yellow: 'warn', red: 'bad', unknown: 'idle' }

    // 每个 Agent 的轨道色：连线、子卡圆点、详情页强调色都跟随它。
    const AGENT_LOOK = {
      content: { hue: '#4CC2FF', glyph: '▣', label: '内容', suffix: ' Agent', icon: 'content' },
      ecommerce: { hue: '#FF8A3D', glyph: '🛍', label: '电商', suffix: ' Agent', icon: 'commerce' },
      opensource: { hue: '#3ED598', glyph: '❋', label: '开源', suffix: ' Agent', icon: 'source' },
      invest: { hue: '#FF6B81', glyph: '↗', label: '投资', suffix: '', icon: 'trend' },
      knowledge: { hue: '#B18CFF', glyph: '▤', label: '运营 · 知识库', suffix: '', icon: 'book' },
      assistant: { hue: '#F5B942', glyph: '🏆', label: '助理', suffix: ' Agent', icon: 'trophy' },
    }

    const ICON_PATHS = {
      content: 'M3 5h14v10H3z M3 15l4-4 3 3 3-3 4 4',
      commerce: 'M5 7h10l-1 8H6L5 7z M7 7V5.5a3 3 0 0 1 6 0V7',
      source: 'M10 3v14 M10 8c0-2 2-3 4-3 M10 11c0 2-2 3-4 3',
      trend: 'M3 14l4-4 3 3 6-6 M12 7h4v4',
      book: 'M4 4h7a2 2 0 0 1 2 2v10H6a2 2 0 0 1-2-2V4z M13 6a2 2 0 0 1 2-2h2v12h-4',
      trophy: 'M6 4h8v5a4 4 0 0 1-8 0V4z M6 6H4v2a2 2 0 0 0 2 2 M14 6h2v2a2 2 0 0 1-2 2 M10 13v3 M7 17h6',
      radar: 'M10 3a7 7 0 1 0 7 7 M10 10l5-4',
    }

    /** 线框图标：颜色跟随 --hue，避免用 emoji（不同系统渲染差异太大）。 */
    function Icon({ name, className }) {
      return h('svg', {
        className: `ans-icon ${className || ''}`,
        viewBox: '0 0 20 20',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: '1.4',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      }, h('path', { d: ICON_PATHS[name] || ICON_PATHS.source }))
    }

    const STATUS_TEXT = { green: '绿灯', yellow: '黄灯', red: '红灯', unknown: '灰灯' }
    const WIRE_HEIGHT = 72

    // ── 基础组件 ─────────────────────────────────────────────

    function Dot({ tone, title }) {
      return h('i', { className: `ans-dot ${tone}`, title, role: 'img', 'aria-label': title || tone })
    }

    function Card({ title, right, children, className, hue }) {
      return h('section', {
        className: `ans-card ${className || ''}`,
        style: hue ? { '--hue': hue } : undefined,
      },
      (title || right) && h('header', { className: 'ans-card-head' },
        h('h3', null, title),
        right ? h('div', { className: 'ans-card-right' }, right) : null),
      h('div', { className: 'ans-card-body' }, children))
    }

    function Kpi({ label, value, sub, hue }) {
      return h('div', { className: 'ans-kpi', style: hue ? { '--hue': hue } : undefined },
        h('span', { className: 'ans-kpi-label' }, label),
        h('b', { className: 'ans-kpi-value' }, value),
        sub ? h('span', { className: 'ans-kpi-sub' }, sub) : null)
    }

    function Empty({ title, body, children }) {
      return h('div', { className: 'ans-empty' },
        h('p', { className: 'ans-empty-title' }, title),
        body ? h('p', { className: 'ans-empty-body' }, body) : null,
        children ? h('div', { className: 'ans-empty-actions' }, children) : null)
    }

    function Chip({ tone, children }) {
      return h('span', { className: `ans-chip ${tone || ''}` }, children)
    }

    /** 每天新增柱图：虚线方框 = 未来，实心 = 已有数据，今天的柱子淡红。 */
    function DayBars({ days, unit, hue }) {
      const max = Math.max(1, ...days.map((d) => Math.abs(d.value || 0)))
      return h('div', { className: 'ans-days', style: { '--hue': hue } },
        h('div', { className: 'ans-days-plot' }, days.map((day, i) => {
          const height = day.value === null || day.value === 0 ? 0 : Math.max(6, Math.round((Math.abs(day.value) / max) * 100))
          return h('div', { className: 'ans-day', key: i, title: `${day.label} ${day.value === null ? '无数据' : `${day.value}${unit || ''}`}` },
            day.value !== null && day.value !== 0
              ? h('span', { className: 'ans-day-value' }, compact(day.value))
              : null,
            h('span', {
              className: `ans-day-bar ${day.value === null ? 'is-null' : ''} ${day.today ? 'is-today' : ''} ${day.zero ? 'is-zero' : ''}`,
              style: day.value === null ? undefined : { height: `${height}%` },
            }))
        })),
        h('div', { className: 'ans-days-axis' }, days.map((day, i) => h('span', { key: i, className: day.today ? 'is-today' : '' },
          h('b', null, day.day), h('small', null, day.weekday)))))
    }

    // ── 拓扑：创始人 → CEO → 6 路 Agent ───────────────────────

    function Topology({ data, focus, onFocus, ask, openDetail }) {
      const modules = data.modules
      const sources = data.sources
      const active = modules.filter((module) => module.phase === 'active')
      const activeSources = sources.filter((source) => active.some((module) => module.id === source.moduleId))
      const activeFresh = activeSources.filter((source) => source.status === 'green').length
      const counts = data.counts
      const lanes = modules.map((module) => ({ module, look: AGENT_LOOK[module.id] || { hue: '#8C99AB', glyph: '•', label: module.name, suffix: '', icon: 'source' } }))
      const cols = lanes.length

      return h('section', { className: 'ans-tree' },
        // 创始人
        h('div', { className: 'ans-tree-top' },
          h('article', { className: 'ans-founder' },
            h('span', { className: 'ans-founder-avatar' }, 'S'),
            h('div', { className: 'ans-founder-main' },
              h('b', null, '你'),
              h('small', null, '创始人 · 拍板定方向')),
            h('span', { className: 'ans-founder-wait' }, `等你 ${counts.decisionsPending} 件`)),

          h('div', { className: 'ans-tree-pipes' },
            h('div', { className: 'ans-pipe is-down' },
              h('span', { className: 'ans-pipe-title' }, '↓ 拍板 · 定方向'),
              h('span', { className: 'ans-pipe-meta' }, `${counts.decisionsPending} 件待决 · ${counts.decisionsTotal} 件累计`)),
            h('div', { className: 'ans-pipe is-up' },
              h('span', { className: 'ans-pipe-title' }, `↑ 汇报 ${timeOfBrief(data)}`),
              h('span', { className: 'ans-pipe-meta' }, '每天 3 次 · 08:20 / 12:20 / 20:20'))),

          h('article', { className: 'ans-ceo' },
            h('span', { className: 'ans-ceo-radar', 'aria-hidden': 'true' },
              h(Icon, { name: 'radar', className: 'ans-ceo-radar-icon' })),
            h('div', { className: 'ans-ceo-main' },
              h('b', null, 'CEO Agent'),
              h('small', null, `${activeFresh}/${activeSources.length} 个数据源新鲜 · 巡查 ${counts.auditEntries} 条记录`),
              h('em', null, data.paused ? '已暂停：不生成简报、不派活' : '等数据刷新')),
            h('span', { className: 'ans-ceo-state' }, h(Dot, { tone: data.paused ? 'warn' : 'ok' })))),

        // 分叉
        h('div', { className: 'ans-fork', style: { '--cols': cols } },

          // 6 路连线（每人一条带光点）：从 CEO 底部聚到卡片头顶
          h('div', { className: 'ans-wires', 'aria-hidden': 'true' },
            lanes.map(({ module, look }, i) => {
              const x = ((i + 0.5) / cols) * 100
              const d = `M50,0 C50,${Math.round(WIRE_HEIGHT * 0.45)} ${x},${Math.round(WIRE_HEIGHT * 0.45)} ${x},${WIRE_HEIGHT}`
              return h('svg', { key: module.id, className: 'ans-wire', viewBox: `0 0 100 ${WIRE_HEIGHT}`, preserveAspectRatio: 'none' },
                h('path', { className: 'ans-wire-path', d, style: { stroke: look.hue } }),
                h('circle', { className: 'ans-wire-dot', r: '1.5', style: { fill: look.hue } },
                  h('animateMotion', {
                    dur: `${(5.5 + i * 0.6).toFixed(1)}s`,
                    repeatCount: 'indefinite',
                    begin: `${(i * 0.5).toFixed(2)}s`,
                    path: d,
                  })),
                h('circle', { className: 'ans-wire-cap', cx: String(x), cy: String(WIRE_HEIGHT - 1), r: '1.1', style: { fill: look.hue } }))
            })),

          // 每路一张 Agent 卡（可点开详情）
          h('div', { className: 'ans-agents' }, lanes.map(({ module, look }) => {
            const agent = agentSnapshot(module, sources)
            const tone = TONE[module.freshness.state] || 'idle'
            const isFocus = focus === module.id
            return h('div', { className: 'ans-lane', key: module.id, style: { '--hue': look.hue } },
              h('button', {
                type: 'button',
                className: `ans-agent ${isFocus ? 'is-focus' : ''}`,
                onClick: () => { onFocus(module.id); openDetail(module.id) },
                'aria-pressed': isFocus,
              },
              h('span', { className: 'ans-agent-head' },
                h(Icon, { name: look.icon, className: 'ans-agent-glyph' }),
                h('span', { className: 'ans-agent-name' }, `${look.label}${look.suffix}`),
                h('span', { className: 'ans-agent-state' }, h(Dot, { tone, title: `${look.label}：${STATUS_TEXT[module.freshness.state]}` }))),
              h('span', { className: 'ans-agent-metric' },
                h('b', null, agent.value),
                h('small', null, agent.label)),
              h('span', { className: 'ans-agent-foot' }, agent.foot)
              )
            )
          }))
        )
      )
    }

    function countStatus(data, state) {
      return data.sources.filter((item) => item.status === state).length
    }

    function timeOfBrief(data) {
      const brief = data.brief
      return brief ? timeHM(brief.createdAt) : '08:20'
    }

    /** Agent 卡上的一句话状态：有数据说数据，没数据就说没数据。 */
    function agentSnapshot(module, sources) {
      const own = sources.filter((item) => item.moduleId === module.id)
      const fresh = own.filter((item) => item.status === 'green').length
      const stale = own.filter((item) => item.status === 'yellow' || item.status === 'red').length
      const metric = module.primaryMetric
      const foot = own.length
        ? `上次 ${own.map((item) => (item.lastSuccessAt ? timeHM(item.lastSuccessAt) : '未同步')).slice(0, 1).join('')} → 下次 ${own.length ? `${(own[0].cadenceHours || 24)}h 后` : '—'}`
        : '未接数据源'
      return {
        value: own.length ? (fresh ? '已接' : '待采') : '—',
        label: metric ? metric.label : module.tagline,
        foot: stale ? `${stale} 个源偏旧 · ${foot}` : foot,
      }
    }

    // ── 总览页 ───────────────────────────────────────────────

    function OverviewPage({ data, focus, onFocus, ask, openDetail, now }) {
      const counts = data.counts
      const status = data.dataStatus
      const alerts = status.yellow + status.red
      const hasData = counts.snapshots > 0
      return h('div', { className: 'ans-page' },
        h(Topology, { data, focus, onFocus, ask, openDetail }),

        h('div', { className: 'ans-kpis' },
          h(Kpi, { label: '待拍板', value: PLAIN.format(counts.decisionsPending), sub: counts.decisionsPending ? '等你决定' : '没有待决事项', hue: 'var(--primary)' }),
          h(Kpi, { label: '执行中', value: PLAIN.format(counts.tasksActive), sub: counts.tasksActive ? 'Agent 在干活' : '队列空闲' }),
          h(Kpi, { label: '数据告警', value: PLAIN.format(alerts), sub: alerts ? `${status.yellow} 偏旧 · ${status.red} 阻断` : '全部新鲜' }),
          h(Kpi, { label: '快照', value: compact(counts.snapshots), sub: hasData ? '不可变快照' : '等待第一批数据' })),

        h(Card, { title: 'CEO 简报 · 今日判断', right: h('span', { className: 'ans-meta' }, hasData ? '待生成' : '需要数据') },
          !hasData
            ? h(Empty, {
                title: '先接入一个数据源',
                body: '每一条判断都必须点回快照和指标。没有真实数据时，这里只说明缺什么，不会给“看起来合理”的建议。',
              },
              h('button', { type: 'button', className: 'ans-btn primary', onClick: () => ask(PROMPT_DATA) }, '问 CEO 先接什么数据'))
            : h('p', { className: 'ans-hint' }, '已有快照。简报生成器在 Phase 1 接入：异常规则 → 观测 → 简报 → 决策收件箱。')),

        h('div', { className: 'ans-two' },
          h(Card, { title: '数据健康', right: h('span', { className: 'ans-meta' }, `${status.green}/${status.total} 新鲜`) },
            h('div', { className: 'ans-health' }, data.sources.map((source) => h('div', { className: 'ans-health-row', key: source.id },
              h(Dot, { tone: TONE[source.status], title: STATUS_TEXT[source.status] }),
              h('span', { className: 'ans-health-name' }, source.name),
              h('span', { className: 'ans-health-module' }, source.moduleName),
              h('span', { className: 'ans-health-time' }, source.lastSuccessAt ? `${timeHM(source.lastSuccessAt)} 同步` : '未同步'))))),
          h(Card, { title: '最近活动', right: h('span', { className: 'ans-meta' }, `${counts.auditEntries} 条`) },
            data.auditPreview && data.auditPreview.length
              ? h('div', { className: 'ans-log' }, data.auditPreview.map((entry) => h('div', { className: 'ans-log-row', key: entry.id },
                  h('span', { className: 'ans-log-t' }, `${dateMD(entry.createdAt)} ${timeHM(entry.createdAt)}`),
                  h('span', { className: 'ans-log-who' }, actorText(entry.actor)),
                  h('span', { className: 'ans-log-msg' }, actionText(entry.action)))))
              : h('p', { className: 'ans-hint' }, '导入数据、拍板、派活都会写进审计链，这里显示最近 6 条。'))))
    }

    const ACTOR_TEXT = { human: '老板', 'ceo-agent': 'CEO', system: '系统', 'content-agent': '内容' }
    const ACTION_TEXT = {
      pause: '暂停了自动化',
      resume: '恢复了自动化',
      import: '导入了数据',
      approve: '拍板通过',
      reject: '驳回',
      'brief.generate': '生成了今日简报',
    }
    const actorText = (actor) => ACTOR_TEXT[actor] || actor
    const actionText = (action) => ACTION_TEXT[action] || action

    // ── 单个 Agent 的详情页（电商 / 内容 / 开源 / 投资 / 知识库 / 助理）──

    function AgentPage({ moduleId, data, ask, detail }) {
      const module = data.modules.find((item) => item.id === moduleId) || data.modules[0]
      const look = AGENT_LOOK[module.id] || { hue: '#8C99AB', glyph: '•', label: module.name, suffix: '', icon: 'source' }
      const sources = (detail && detail.sources) || data.sources.filter((item) => item.moduleId === module.id)
      const tone = TONE[module.freshness.state] || 'idle'
      const days = buildDays(detail ? { history: { [module.id]: detail.history || {} } } : data, module.id)
      const total = days.reduce((sum, day) => sum + (day.value || 0), 0)
      const metricValue = sources.length ? compact(total) : '—'
      const metricNote = sources.length
        ? (total ? `近 14 天新增 · ${days.filter((day) => day.value !== null).length} 天有数据` : '近 14 天没有新增（快照还没有差值）')
        : '未接数据源'
      const agentBrief = buildAgentBrief(module, sources)

      return h('div', { className: 'ans-page', style: { '--hue': look.hue } },
        h('div', { className: 'ans-agenthero' },
          h('div', { className: 'ans-agenthero-head' },
            h(Icon, { name: look.icon, className: 'ans-agenthero-glyph' }),
            h('div', { className: 'ans-agenthero-main' },
              h('b', null, `${look.label}${look.suffix}`),
              h('small', null, module.tagline)),
            h('span', { className: 'ans-agenthero-state' }, h(Dot, { tone, title: STATUS_TEXT[module.freshness.state] }), STATUS_TEXT[module.freshness.state])),
          h('p', { className: 'ans-agenthero-brief' }, agentBrief),

          h('div', { className: 'ans-kpis is-flat' },
          h(Kpi, { label: module.primaryMetric ? module.primaryMetric.label : '主指标', value: metricValue, sub: metricNote, hue: look.hue }),
            h(Kpi, { label: '数据源', value: PLAIN.format(sources.length), sub: sources.length ? `${sources.filter((s) => s.status === 'green').length} 个新鲜` : '未配置' }),
            h(Kpi, { label: '待拍板', value: PLAIN.format(module.pendingDecisions), sub: '来自这个模块' }),
            h(Kpi, { label: '在办任务', value: PLAIN.format(module.activeTasks), sub: '执行 / 验收 / 测量' })),

          h('div', { className: 'ans-row align-start' },
            h(Card, { title: '近 14 天', className: 'ans-grow', right: h('span', { className: 'ans-meta' }, '每天新增（快照相减）') },
              h(DayBars, { days, unit: module.primaryMetric?.unit || '', hue: look.hue }),
              h('p', { className: 'ans-hint' }, sources.length
                ? `${sources.map((s) => s.name).join(' / ')} · 按 ${sources[0].cadenceHours}h 快照相减，算在前一天。`
                : '还没有数据源，柱子全部为空。接入后每天一根。')),
            h(Card, { title: '数据源', className: 'ans-grow-0', right: h('span', { className: 'ans-meta' }, `${sources.length} 个`) },
              sources.length
                ? h('div', { className: 'ans-src-list' }, sources.map((source) => h('div', { className: 'ans-src', key: source.id },
                    h(Dot, { tone: TONE[source.status], title: STATUS_TEXT[source.status] }),
                    h('div', { className: 'ans-src-main' },
                      h('b', null, source.name),
                      h('small', null, `${source.kind === 'csv' ? 'CSV 导入' : source.kind === 'api' ? 'API 拉取' : '手工录入'} · ${source.cadenceHours}h 节奏`)),
                    h('div', { className: 'ans-src-side' },
                      h('b', null, source.lastSuccessAt ? timeHM(source.lastSuccessAt) : '未同步'),
                      h('small', null, source.status === 'yellow' ? `已 ${source.ageHours}h 没更新` : source.status === 'red' ? '超过阻断线' : source.lastSuccessAt ? ago(source.lastSuccessAt) : '—')))))
                : h(Empty, { title: '这个模块还没接数据', body: '先接一个 CSV，指标和异常才有依据。' }))),

          h(Card, { title: '可执行动作', right: h('span', { className: 'ans-meta' }, '风险等级决定谁能做') },
            h('div', { className: 'ans-actions' }, module.actions.map((action) => h('span', { key: action.id, className: 'ans-action' },
              action.label,
              h('em', { className: `lv ${action.risk}` }, action.risk),
              h('small', null, action.riskLabel)))),

          h(Card, { title: '问这个 Agent' },
            h('p', { className: 'ans-hint' }, '会话里它只能读这个模块的数据、提交任务结果；不能自己批准，也不能直接对外发布。'),
            h('button', { type: 'button', className: 'ans-btn primary', onClick: () => ask(`请看一下「${look.label}」模块现在的数据状态，指出最值得做的一件事，并写清楚证据和验证指标。`) }, '带着上下文问它'))
          )
        )
      )
    }

    /** 一句话说明这个 Agent 此刻能做什么、缺什么，用来在详情页给人看。 */
    function buildAgentBrief(module, sources) {
      if (!sources.length) return '这个模块还没有数据源：先在「数据源」接入一份 CSV，Agent 才有可判断的东西。'
      const missing = sources.filter((source) => !source.lastSuccessAt)
      const stale = sources.filter((source) => source.status === 'yellow')
      const blocked = sources.filter((source) => source.status === 'red')
      const parts = []
      if (missing.length) parts.push(`${missing.length} 个源还没同步过`)
      if (stale.length) parts.push(`${stale.length} 个源偏旧（黄色）`)
      if (blocked.length) parts.push(`${blocked.length} 个源超过阻断线（红色）`)
      if (!parts.length) return '数据正常，Agent 可以基于最新快照给建议。'
      return `${parts.join('、')}。红灯的源不会被拿来做判断，Agent 只会说缺什么，不会拿旧数字编结论。`
    }

    function buildDays(data, moduleId) {
      const history = (data.history && data.history[moduleId]) || {}
      const out = []
      const today = new Date()
      for (let i = 13; i >= 0; i -= 1) {
        const d = new Date(today.getTime() - i * 864e5)
        const key = d.toLocaleDateString('en-CA', { timeZone: TZ })
        const future = i < 0
        const value = Object.prototype.hasOwnProperty.call(history, key) ? history[key] : null
        out.push({
          label: key,
          day: d.toLocaleDateString('zh-CN', { timeZone: TZ, day: '2-digit' }),
          weekday: ['日', '一', '二', '三', '四', '五', '六'][Number(d.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' }).length ? new Date(d.toLocaleString('en-US', { timeZone: TZ })).getDay() : 0)],
          value,
          zero: value === 0,
          today: i === 0,
          future,
        })
      }
      return out
    }

    // ── 待办（决策收件箱）────────────────────────────────────

    function TodoPage({ data, ask, goto }) {
      const [filter, setFilter] = React.useState('pending')
      const [open, setOpen] = React.useState(null)
      const rows = data.decisions || []
      const filters = [
        { id: 'pending', label: '待拍板' },
        { id: 'changes_requested', label: '需修改' },
        { id: 'approved', label: '已通过' },
        { id: 'rejected', label: '已驳回' },
        { id: 'all', label: '全部' },
      ]
      const filtered = filter === 'all' ? rows : rows.filter((row) => row.status === filter)
      return h('div', { className: 'ans-page' },
        h('div', { className: 'ans-pagehead' },
          h('div', null,
            h('h1', null, '待办 · 拍板'),
            h('p', { className: 'ans-hint' }, 'AI 只能提建议，拍板永远是你。没有 approved 的决策在数据库层就插不进任务。')),
          h('div', { className: 'ans-pagehead-actions' },
            h('button', { type: 'button', className: 'ans-btn', onClick: () => ask(PROMPT_OVERVIEW) }, '让 CEO 汇总'))),

        h('div', { className: 'ans-filters' }, filters.map((item) => h('button', {
          key: item.id,
          type: 'button',
          className: `ans-filter ${filter === item.id ? 'on' : ''}`,
          onClick: () => setFilter(item.id),
          'aria-pressed': filter === item.id,
        }, item.label,
        item.id === 'pending' && data.counts.decisionsPending ? h('span', { className: 'ans-filter-count' }, data.counts.decisionsPending) : null))),

        filtered.length
          ? h('div', { className: 'ans-todos' }, filtered.map((row) => h('article', { className: 'ans-todo', key: row.id },
              h('span', { className: `ans-lv-chip ${row.riskLevel}` }, row.riskLevel),
              h('div', { className: 'ans-todo-main' },
                h('div', { className: 'ans-todo-title' }, row.title),
                h('div', { className: 'ans-todo-sub' }, row.diagnosis || '暂无诊断说明'),
                h('div', { className: 'ans-todo-meta' },
                  `${row.moduleName} · 证据 ${row.evidence.length} 条 · v${row.version} · ${ago(row.createdAt)}`),
                open === row.id
                  ? h('div', { className: 'ans-todo-detail' },
                      row.recommendation ? h('p', null, `建议：${row.recommendation}`) : null,
                      row.measure && row.measure.metric
                        ? h('p', null, `验证：${row.measure.metric}，基线 ${row.measure.baseline ?? '—'}，目标 ${row.measure.target ?? '—'}`)
                        : h('p', null, '验证计划：待补充'))
                  : null),
              h('div', { className: 'ans-todo-actions' },
                h('button', { type: 'button', className: 'ans-btn', onClick: () => setOpen(open === row.id ? null : row.id) }, open === row.id ? '收起' : '看证据'),
                h('button', { type: 'button', className: 'ans-btn primary', onClick: () => ask(`这条待办「${row.title}」我要拍板。先告诉我：证据够不够、有什么风险、如果通过你会怎么派活、72 小时后用什么指标验收。`) }, '拍板前问问')))))
          : h(Card, null, h(Empty, {
              title: filter === 'pending' ? '没有待你拍板的事' : '这里还是空的',
              body: '决策由 CEO 在拿到快照和异常证据后提出，进入待办后你只做三件事：同意、驳回、要求改。',
            },
            h('button', { type: 'button', className: 'ans-btn', onClick: () => goto('sources') }, '先看数据源'))))
    }

    // ── 数据源 ───────────────────────────────────────────────

    function SourcesPage({ data, ask }) {
      const rows = data.sources
      return h('div', { className: 'ans-page' },
        h('div', { className: 'ans-pagehead' },
          h('div', null,
            h('h1', null, '数据源'),
            h('p', { className: 'ans-hint' }, '数据过期就黄灯，超过阻断线就红灯。看板上每个数字都要能追到快照。')),
          h('div', { className: 'ans-pagehead-actions' },
            h('button', { type: 'button', className: 'ans-btn', onClick: () => ask(PROMPT_DATA) }, '问 CSV 要哪些字段'))),
        rows.length
          ? h(Card, { title: '状态表', right: h('span', { className: 'ans-meta' }, `${rows.length} 个`) },
              h('div', { className: 'ans-scroll' },
                h('table', { className: 'ans-table' },
                  h('thead', null, h('tr', null, ['数据源', '模块', '方式', '状态', '最近成功', '节奏', '快照'].map((label) => h('th', { key: label }, label)))),
                  h('tbody', null, rows.map((row) => h('tr', { key: row.id },
                    h('td', null, row.name),
                    h('td', null, row.moduleName),
                    h('td', null, row.kind === 'csv' ? 'CSV' : row.kind === 'api' ? 'API' : '手工'),
                    h('td', null, h(Dot, { tone: TONE[row.status], title: STATUS_TEXT[row.status] }), ' ', STATUS_TEXT[row.status],
                      row.ageHours !== null ? h('small', null, ` ${row.ageHours}h`) : null),
                    h('td', null, row.lastSuccessAt ? `${dateMD(row.lastSuccessAt)} ${timeHM(row.lastSuccessAt)}` : '未同步'),
                    h('td', null, `${row.cadenceHours}h`),
                    h('td', null, PLAIN.format(row.snapshotCount))))))))
          : h(Card, null, h(Empty, { title: '还没有数据源', body: '先接「内容」：抖音/小红书/B站的导出 CSV 就够跑通闭环。' })))
    }

    // ── AI 工作（运行日志）────────────────────────────────────

    function WorkPage({ data, ask }) {
      const [audit, setAudit] = React.useState(null)
      const [error, setError] = React.useState(null)
      const load = React.useCallback(async () => {
        try {
          setAudit(await api('/audit?limit=80'))
          setError(null)
        } catch (err) {
          setError(err.message)
        }
      }, [])
      React.useEffect(() => { load() }, [load])
      return h('div', { className: 'ans-page' },
        h('div', { className: 'ans-pagehead' },
          h('div', null,
            h('h1', null, 'AI 工作'),
            h('p', { className: 'ans-hint' }, '每个 Agent 的动作都写进审计链：谁、什么时候、对哪个实体做了什么。')),
          h('div', { className: 'ans-pagehead-actions' },
            h('button', { type: 'button', className: 'ans-btn', onClick: load }, '刷新'),
            h('button', { type: 'button', className: 'ans-btn primary', onClick: () => ask(PROMPT_OVERVIEW) }, '找 CEO 汇报'))),

        h('div', { className: 'ans-kpis' },
          h(Kpi, { label: '审计事件', value: PLAIN.format(data.counts.auditEntries) }),
          h(Kpi, { label: '快照', value: PLAIN.format(data.counts.snapshots) }),
          h(Kpi, { label: '任务', value: PLAIN.format(data.counts.tasksTotal) }),
          h(Kpi, { label: '链完整性', value: audit ? (audit.chain.ok ? '完整' : '断裂') : '…',
            sub: audit && !audit.chain.ok ? `断在 ${audit.chain.brokenAt}` : 'hash 链可校验' })),

        h(Card, { title: 'company.log', right: h('span', { className: 'ans-meta' }, '各岗位在干什么') },
          error ? h('p', { className: 'ans-hint' }, error)
            : audit && audit.entries.length
              ? h('div', { className: 'ans-log' }, audit.entries.map((entry) => h('div', { className: 'ans-log-row', key: entry.id },
                  h('span', { className: 'ans-log-t' }, `${dateMD(entry.createdAt)} ${timeHM(entry.createdAt)}`),
                  h('span', { className: 'ans-log-who' }, actorText(entry.actor)),
                  h('span', { className: 'ans-log-msg' }, actionText(entry.action)),
                  h('code', { className: 'ans-log-hash' }, entry.hash.slice(0, 8)))))
              : h('p', { className: 'ans-hint' }, audit ? '还没有事件。' : '读取中…')))

    }

    // ── 设置 ─────────────────────────────────────────────────

    function SettingsPage({ data, onTogglePause, busy, toast }) {
      return h('div', { className: 'ans-page' },
        h('div', { className: 'ans-pagehead' },
          h('div', null,
            h('h1', null, '设置'),
            h('p', { className: 'ans-hint' }, '这里是唯一能改变系统行为的地方；改动都会写进审计链。'))),
        h(Card, { title: '全局暂停' },
          h('p', { className: 'ans-hint' }, '暂停后 CEO 不生成简报、不派活，已批准的任务也不再启动。看数据、看审计不受影响。'),
          h('div', { className: 'ans-row' },
            h('button', { type: 'button', className: `ans-btn ${data.paused ? '' : 'primary'}`, disabled: busy, onClick: () => onTogglePause(!data.paused) },
              busy ? '保存中…' : data.paused ? '恢复自动化' : '暂停自动化'),
            h(Chip, { tone: data.paused ? 'warn' : 'ok' }, data.paused ? '已暂停' : '运行中'),
            toast ? h('span', { className: 'ans-toast-inline' }, toast) : null)),
        h(Card, { title: '版本与数据' },
          h('dl', { className: 'ans-kv' },
            h('div', null, h('dt', null, '插件版本'), h('dd', null, data.plugin.version)),
            h('div', null, h('dt', null, '库结构版本'), h('dd', null, `v${data.plugin.schemaVersion}`)),
            h('div', null, h('dt', null, '数据库'), h('dd', null, data.health.db === 'ready' ? 'ready（WAL）' : '不可用')),
            h('div', null, h('dt', null, '审计链'), h('dd', null, data.health.audit.ok ? `完整（${data.health.audit.checked} 条）` : '断裂')))),
        h(Card, { title: '权限边界' },
          h('ul', { className: 'ans-bullets' },
            h('li', null, '审批只从界面发起：模型工具表里没有 approve，也没有执行外部动作的工具。'),
            h('li', null, 'R2 动作需要你逐条通过；R3（上架、发布、投资买卖）额外要求输入确认短语。'),
            h('li', null, '投资数据的模型出口当前设为「完全允许」（按你的选择），可在模块配置里改回禁止。'))))
    }

    // ── 会话抽屉 ─────────────────────────────────────────────

    function ChatDrawer({ conversation, onClose, onStart, starting, hint }) {
      return h('aside', { className: 'ans-chat', 'aria-label': 'CEO 对话' },
        h('header', { className: 'ans-chat-head' },
          h('div', null, h('b', null, 'CEO'), h('small', null, '只提建议，拍板在你')),
          h('button', { type: 'button', className: 'ans-icon-btn', onClick: onClose, 'aria-label': '关闭对话' }, '×')),
        h('div', { className: 'ans-chat-body' },
          conversation
            ? h('div', { className: 'ans-chat-node' }, conversation)
            : h('div', { className: 'ans-chat-empty' },
                h('p', { className: 'ans-empty-title' }, '还没有打开工作台会话'),
                h('p', { className: 'ans-empty-body' }, hint || '会话会绑定到这个工作台，草稿由你确认后发送。'),
                h('button', { type: 'button', className: 'ans-btn primary', disabled: starting, onClick: onStart },
                  starting ? '正在打开…' : '开始工作台会话'))))
    }

    // ── 提示词 ───────────────────────────────────────────────

    const PROMPT_OVERVIEW = [
      '请基于工作台里的真实数据生成今日简报。',
      '要求：最多 3 条判断；每条写清楚发生了什么（含数字、周期、样本量）、证据来自哪个快照、建议动作、以及 72 小时后用什么指标验证。',
      '没有数据就直接说缺什么数据、为什么需要它，不要编造数字。',
    ].join('\n')

    const PROMPT_DATA = [
      '我现在要接入第一个数据源，目标是让「内容」模块跑通闭环（导入 → 指标 → 异常 → 建议 → 拍板 → 派活 → 验收 → 回数据）。',
      '请告诉我：1) 最少需要哪几个字段；2) 抖音/小红书/B站 导出 CSV 时要注意什么；3) 第一轮先看哪 3 个指标，为什么。',
    ].join('\n')

    // ── 主界面 ───────────────────────────────────────────────

    const TABS = [
      { key: 'overview', label: '总览' },
      { key: 'ecommerce', label: '电商', module: 'ecommerce' },
      { key: 'content', label: '内容', module: 'content' },
      { key: 'opensource', label: '开源', module: 'opensource' },
      { key: 'invest', label: '投资', module: 'invest' },
      { key: 'aiwork', label: 'AI 工作' },
      { key: 'sources', label: '数据源' },
      { key: 'todo', label: '待办' },
    ]

    function App({ service, entry, active, conversation }) {
      const boot = useBootstrap()
      const now = useTick(1000)
      const [tab, setTabState] = React.useState('overview')
      const [focus, setFocus] = React.useState(null)
      const [chatOpen, setChatOpen] = React.useState(false)
      const [starting, setStarting] = React.useState(false)
      const [detail, setDetail] = React.useState({ decisions: [], tasks: [], sources: [], auditPreview: [] })
      const [moduleDetail, setModuleDetail] = React.useState({})
      const [pauseBusy, setPauseBusy] = React.useState(false)
      const [toast, setToast] = React.useState(null)
      const timers = React.useRef([])
      const mainRef = React.useRef(null)

      React.useEffect(() => () => { timers.current.forEach((timer) => clearInterval(timer)) }, [])

      const setTab = React.useCallback((next) => {
        setTabState(next)
        if (mainRef.current) mainRef.current.scrollTop = 0
      }, [])

      React.useEffect(() => {
        if (!boot.data) return
        api('/sources').then((payload) => setDetail((prev) => ({ ...prev, sources: payload.sources }))).catch(() => {})
        api('/decisions').then((payload) => setDetail((prev) => ({ ...prev, decisions: payload.decisions }))).catch(() => {})
        api('/audit?limit=6').then((payload) => setDetail((prev) => ({ ...prev, auditPreview: payload.entries }))).catch(() => {})
      }, [boot.data])

      // 模块详情按需拉取，切页时不重复请求同一个模块。
      const loadModuleDetail = React.useCallback(async (moduleId) => {
        try {
          const payload = await api(`/detail/${moduleId}`)
          setModuleDetail((prev) => ({ ...prev, [moduleId]: payload }))
        } catch { /* 详情失败时用 bootstrap 的数据兜底 */ }
      }, [])

      React.useEffect(() => {
        if (!AGENT_LOOK[tab] && tab !== 'content') return
        if (!AGENT_LOOK[tab]) return
        loadModuleDetail(tab)
      }, [tab, loadModuleDetail])

      const data = boot.data ? { ...boot.data, ...detail } : null

      const flash = (message) => {
        setToast(message)
        const timer = setTimeout(() => setToast(null), 3200)
        timers.current.push(timer)
      }

      const fillDraft = React.useCallback((sessionId, prompt) => {
        const sessions = service?.ctx?.sessions
        if (!sessions) return false
        const actx = sessions.scope?.(sessionId)
        const input = actx?.get?.('conversation')?.input?.for?.(actx)
        if (!input?.setDraft) return false
        input.setDraft(prompt)
        return true
      }, [service])

      const ask = async (prompt) => {
        setChatOpen(true)
        if (!service) {
          flash('会话服务还没就绪，稍后再试')
          return
        }
        try {
          let sessionId = service.currentSession?.() || null
          if (!sessionId || !service.ownsSession?.(sessionId)) {
            setStarting(true)
            sessionId = service.defaultWorkspace?.() ? await service.newSession?.() : await service.newWorkspaceSession?.()
          }
          if (!sessionId) {
            flash('没有创建会话，先选择一个工作区再试')
            return
          }
          let tries = 0
          const timer = setInterval(() => {
            tries += 1
            if (fillDraft(sessionId, prompt) || tries > 40) clearInterval(timer)
          }, 400)
          timers.current.push(timer)
        } catch (error) {
          flash(error?.message || '打开会话失败')
        } finally {
          setStarting(false)
        }
      }

      const togglePause = async (next) => {
        setPauseBusy(true)
        try {
          await api('/settings/pause', { method: 'POST', body: { paused: next } })
          await boot.reload()
          flash(next ? '已暂停自动化' : '已恢复自动化')
        } catch (error) {
          flash(error.message)
        } finally {
          setPauseBusy(false)
        }
      }

      const openDetail = (moduleId) => setTab(moduleId)

      const renderBody = () => {
        if (!data) {
          return boot.error
            ? h(Card, { title: '连接不上工作台服务' },
                h('p', { className: 'ans-hint' }, boot.error),
                h('button', { type: 'button', className: 'ans-btn', onClick: boot.reload }, '重试'))
            : h('div', { className: 'ans-loading' }, h('span', null, '正在读取工作台…'))
        }
        if (tab === 'overview') return h(OverviewPage, { data, focus, onFocus: setFocus, ask, openDetail, now })
        if (tab === 'todo') return h(TodoPage, { data, ask, goto: setTab })
        if (tab === 'aiwork') return h(WorkPage, { data, ask })
        if (tab === 'sources') return h(SourcesPage, { data, ask })
        if (tab === 'settings') return h(SettingsPage, { data, onTogglePause: togglePause, busy: pauseBusy, toast })
        return h(AgentPage, { moduleId: tab, data, ask, detail: moduleDetail[tab] })
      }

      const status = data?.dataStatus
      const agents = status ? status.total : 0
      const onDuty = status ? status.green : 0
      const apiDot = boot.error && !data ? 'bad' : 'ok'
      const apiLabel = boot.error && !data ? '离线' : '实时'

      return h('section', { className: 'ans-root', 'aria-label': 'Agent New Media Studio 经营工作台' },
        h('header', { className: 'ans-toolbar', 'data-dsh-workbench-toolbar': '' },
          h('div', { className: 'ans-brand' },
            h('span', { className: 'ans-mark', 'aria-hidden': 'true' }),
            h('div', { className: 'ans-brand-text' },
              h('b', null, 'AGENT NEW MEDIA'),
              h('small', null, '一人公司 · 经营工作台'))),
          h('nav', { className: 'ans-tabs', 'aria-label': '主导航' }, TABS.map((item) => h('button', {
            key: item.key,
            type: 'button',
            className: `ans-tab ${tab === item.key ? 'on' : ''}`,
            onClick: () => setTab(item.key),
            'aria-current': tab === item.key ? 'page' : undefined,
          }, item.label, item.key === 'todo' && data?.counts.decisionsPending
            ? h('span', { className: 'ans-badge' }, data.counts.decisionsPending)
            : null))),
          h('div', { className: 'ans-toolbar-right' },
            h('span', { className: 'ans-live' }, h(Dot, { tone: apiDot, title: apiLabel }), `${onDuty}/${agents} 个数据源新鲜`),
            h('span', { className: 'ans-clock' }, `${clockText(now)} CST`),
            h('button', { type: 'button', className: 'ans-btn', onClick: boot.reload }, '刷新'),
            h('button', { type: 'button', className: `ans-btn ${chatOpen ? '' : 'primary'}`, onClick: () => setChatOpen((open) => !open), 'aria-pressed': chatOpen },
              chatOpen ? '收起对话' : '问 CEO'),
            h('button', { type: 'button', className: 'ans-gear', onClick: () => setTab('settings'), 'aria-label': '设置', title: '设置' }, '⚙'))),

        h('div', { className: 'ans-body' },
          h('main', { className: 'ans-main', ref: mainRef },
            boot.error && data ? h('div', { className: 'ans-banner' }, `刷新失败：${boot.error}（显示的是上次结果）`) : null,
            renderBody()),
          chatOpen
            ? h(ChatDrawer, {
                conversation: active ? conversation : null,
                starting,
                hint: '草稿会写进这条会话的输入框，你确认后再发送。',
                onClose: () => setChatOpen(false),
                onStart: async () => {
                  try {
                    setStarting(true)
                    if (service?.defaultWorkspace?.()) await service.newSession?.()
                    else await service.newWorkspaceSession?.()
                  } catch (error) {
                    flash(error?.message || '创建会话失败')
                  } finally {
                    setStarting(false)
                  }
                },
              })
            : null),

        h('footer', { className: 'ans-foot' },
          data
            ? `快照 ${PLAIN.format(data.counts.snapshots)} · 决策 ${PLAIN.format(data.counts.decisionsTotal)} · 任务 ${PLAIN.format(data.counts.tasksTotal)} · 审计链 ${data.health.audit.ok ? '完整' : '断裂'}`
            : '正在连接本机服务…'),

        toast ? h('div', { className: 'ans-toast', role: 'status' }, toast) : null)
    }

    // ── 样式 ─────────────────────────────────────────────────

    const CSS = `
.ans-root{
  position:relative;flex:1 1 auto;display:flex;flex-direction:column;height:100%;min-height:0;min-width:0;overflow:hidden;
  container-type:inline-size;
  --bg-base:#05070B;--bg-panel:#0B1017;--bg-soft:#0F151E;
  --border:rgba(255,255,255,.08);--border-strong:rgba(255,255,255,.14);
  --primary:#FF5A1F;--ok:#3ED598;--warn:#F5B942;--danger:#FF4D4F;
  --text:#E8EDF5;--text-dim:#8C99AB;--text-faint:#6B7789;
  background:
    radial-gradient(1200px 520px at 50% -160px, rgba(76,194,255,.10), transparent 70%),
    radial-gradient(900px 420px at 12% 8%, rgba(255,90,31,.07), transparent 70%),
    var(--bg-base);
  color:var(--text);
  font-family:Inter,-apple-system,"Segoe UI","Microsoft YaHei","PingFang SC",system-ui,sans-serif;
  font-size:13.5px;line-height:1.5;
}
.ans-root *{box-sizing:border-box}
.ans-root button{font-family:inherit;color:inherit}

/* 顶栏 */
.ans-toolbar{flex:none;display:flex;align-items:center;gap:16px;padding:8px 16px;min-height:52px;
  border-bottom:1px solid var(--border);background:linear-gradient(180deg,rgba(255,90,31,.05),transparent);flex-wrap:wrap}
.ans-brand{display:flex;align-items:center;gap:9px;min-width:0}
.ans-mark{width:18px;height:18px;border-radius:5px;flex:none;
  background:radial-gradient(circle at 30% 30%,#FF8A3D,var(--primary));box-shadow:0 0 12px rgba(255,90,31,.55)}
.ans-brand-text{display:flex;flex-direction:column;min-width:0}
.ans-brand-text b{font-size:13px;font-weight:700;letter-spacing:1.4px;white-space:nowrap;
  background:linear-gradient(92deg,#FFFFFF 0%,#FFC49A 46%,#FF7A3A 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
.ans-brand-text small{font-size:10px;color:var(--text-faint);letter-spacing:.4px;white-space:nowrap}
.ans-tabs{display:flex;gap:2px;min-width:0;overflow-x:auto;scrollbar-width:none}
.ans-tabs::-webkit-scrollbar{display:none}
.ans-tab{appearance:none;border:0;background:transparent;color:var(--text-dim);padding:8px 12px;font-size:13px;
  cursor:pointer;white-space:nowrap;border-radius:9px;display:inline-flex;align-items:center;gap:6px}
.ans-tab:hover{color:var(--text);background:rgba(255,255,255,.04)}
.ans-tab.on{color:#fff;background:rgba(255,90,31,.16);box-shadow:inset 0 0 0 1px rgba(255,120,70,.45),0 0 16px rgba(255,90,31,.18)}
.ans-badge{min-width:17px;padding:0 5px;border-radius:9px;background:var(--primary);color:#1a0d05;font-size:11px;
  line-height:17px;text-align:center;font-weight:700}
.ans-toolbar-right{margin-left:auto;display:flex;align-items:center;gap:12px;min-width:0}
.ans-live{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-dim);white-space:nowrap}
.ans-clock{font-size:12px;color:var(--text-dim);font-variant-numeric:tabular-nums;letter-spacing:.5px;white-space:nowrap}
.ans-gear{width:28px;height:28px;border-radius:8px;border:1px solid var(--border);background:var(--bg-soft);
  color:var(--text-dim);cursor:pointer;font-size:13px;line-height:1}
.ans-gear:hover{color:var(--text);border-color:var(--border-strong)}

/* 主体 */
.ans-body{flex:1;display:flex;min-height:0;min-width:0}
.ans-main{flex:1;min-width:0;min-height:0;overflow:auto;padding:16px 18px 22px;container-type:inline-size}
.ans-page{display:flex;flex-direction:column;gap:16px;max-width:1420px;margin:0 auto}
.ans-loading{display:grid;place-items:center;height:100%;color:var(--text-faint);font-size:12px}
.ans-banner{padding:8px 12px;border:1px dashed rgba(245,185,66,.4);border-radius:10px;background:rgba(245,185,66,.08);
  color:var(--warn);font-size:12px;margin-bottom:12px}

/* 按钮 */
.ans-btn{appearance:none;display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:9px;
  border:1px solid var(--border);background:var(--bg-soft);color:var(--text);font-size:12.5px;cursor:pointer;white-space:nowrap}
.ans-btn:hover{border-color:rgba(255,90,31,.5)}
.ans-btn.primary{background:rgba(255,90,31,.16);border-color:rgba(255,90,31,.42);color:#FF8A5A}
.ans-btn:disabled{opacity:.5;cursor:default}

/* 状态点 */
.ans-dot{display:inline-block;width:7px;height:7px;border-radius:50%;flex:none;vertical-align:middle}
.ans-dot.ok{background:var(--ok);box-shadow:0 0 8px rgba(62,213,152,.85)}
.ans-dot.warn{background:var(--warn);box-shadow:0 0 8px rgba(245,185,66,.8)}
.ans-dot.bad{background:var(--danger);box-shadow:0 0 8px rgba(255,77,79,.8)}
.ans-dot.idle{background:#5A6472}

/* 拓扑 */
.ans-tree{position:relative;border:1px solid var(--border);border-radius:20px;padding:18px 16px 14px;
  background:radial-gradient(700px 260px at 50% 0,rgba(76,194,255,.08),transparent 70%),var(--bg-panel);
  box-shadow:0 0 0 1px rgba(255,255,255,.02),0 18px 48px rgba(0,0,0,.45);overflow:hidden}
.ans-tree-top{display:flex;flex-direction:column;align-items:center;gap:10px;padding-bottom:10px}
.ans-ceo,.ans-founder{position:relative;z-index:1}
.ans-founder{display:flex;align-items:center;gap:12px;padding:10px 16px;border-radius:16px;
  background:radial-gradient(320px 120px at 50% 0,rgba(255,90,31,.22),rgba(255,90,31,.04));
  border:1px solid rgba(255,140,90,.45);box-shadow:0 0 34px rgba(255,90,31,.22),inset 0 1px 0 rgba(255,255,255,.06);
  max-width:min(520px,90%)}
.ans-founder-avatar{width:38px;height:38px;border-radius:50%;flex:none;display:grid;place-items:center;font-weight:700;font-size:16px;
  color:#2a1104;background:radial-gradient(circle at 35% 30%,#FFB37A,var(--primary));box-shadow:0 0 16px rgba(255,90,31,.5)}
.ans-founder-main{display:flex;flex-direction:column;min-width:0}
.ans-founder-main b{font-size:15px;font-weight:700}
.ans-founder-main small{font-size:12px;color:var(--text-dim)}
.ans-founder-wait{margin-left:6px;padding:5px 11px;border-radius:9px;font-size:12px;font-weight:600;
  color:var(--primary);background:rgba(255,90,31,.14);border:1px solid rgba(255,90,31,.36);white-space:nowrap}

.ans-tree-pipes{display:flex;gap:12px;flex-wrap:wrap;justify-content:center}
.ans-pipe{display:flex;flex-direction:column;gap:1px;padding:7px 12px;border-radius:11px;
  background:var(--bg-soft);border:1px solid var(--border);min-width:170px}
.ans-pipe.is-down{border-color:rgba(255,90,31,.30)}
.ans-pipe.is-up{border-color:rgba(76,194,255,.28)}
.ans-pipe-title{font-size:12.5px;font-weight:600}
.ans-pipe.is-down .ans-pipe-title{color:#FF8A5A}
.ans-pipe.is-up .ans-pipe-title{color:#6FD3FF}
.ans-pipe-meta{font-size:11.5px;color:var(--text-dim)}

.ans-ceo{position:relative;display:flex;align-items:center;gap:14px;padding:12px 18px;border-radius:16px;max-width:min(620px,94%);
  background:linear-gradient(180deg,rgba(76,194,255,.07),rgba(11,16,23,.9));
  border:1px solid rgba(76,194,255,.35);box-shadow:0 0 30px rgba(76,194,255,.16)}
.ans-ceo-radar{width:46px;height:46px;border-radius:50%;flex:none;position:relative;display:grid;place-items:center;
  background:conic-gradient(from 200deg,rgba(76,194,255,.55),rgba(76,194,255,.05) 42%,transparent 55%);
  box-shadow:inset 0 0 0 1px rgba(76,194,255,.35),0 0 18px rgba(76,194,255,.28);animation:ans-spin 4.5s linear infinite}
.ans-ceo-radar-icon{width:22px;height:22px;color:#9FE0FF;position:relative;z-index:1;filter:drop-shadow(0 0 6px rgba(76,194,255,.7))}
.ans-ceo-main{display:flex;flex-direction:column;min-width:0;gap:1px}
.ans-ceo-main b{font-size:15px;font-weight:700}
.ans-ceo-main small{font-size:12px;color:var(--text-dim)}
.ans-ceo-main em{font-style:normal;font-size:12px;color:#6FD3FF}
.ans-ceo-state{margin-left:auto}
@keyframes ans-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.ans-ceo-radar{animation:none}}

.ans-fork{position:relative;margin-top:0;padding-top:0}
.ans-wires{position:absolute;left:0;right:0;top:0;height:72px;display:grid;grid-template-columns:repeat(var(--cols),minmax(0,1fr));
  pointer-events:none;z-index:0}
.ans-wire{width:100%;height:72px;overflow:visible}
.ans-wire-path{fill:none;stroke-width:1.3;opacity:.62;vector-effect:non-scaling-stroke;filter:drop-shadow(0 0 3px currentColor)}
.ans-wire-dot{opacity:.95;filter:drop-shadow(0 0 4px currentColor)}
.ans-wire-cap{opacity:.9}

.ans-agents{position:relative;z-index:1;display:grid;grid-template-columns:repeat(var(--cols,6),minmax(0,1fr));gap:12px;padding-top:82px}
.ans-lane{min-width:0;position:relative}
.ans-agent{appearance:none;width:100%;display:flex;flex-direction:column;gap:7px;text-align:left;cursor:pointer;
  padding:12px 13px;border-radius:15px;background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.01)),var(--bg-panel);
  border:1px solid var(--border);transition:border-color .16s ease,box-shadow .16s ease,transform .16s ease}
.ans-agent:hover{border-color:color-mix(in srgb,var(--hue) 55%,transparent);box-shadow:0 0 22px color-mix(in srgb,var(--hue) 22%,transparent);transform:translateY(-1px)}
.ans-agent.is-focus{border-color:color-mix(in srgb,var(--hue) 70%,transparent);
  box-shadow:0 0 0 1px color-mix(in srgb,var(--hue) 45%,transparent),0 0 26px color-mix(in srgb,var(--hue) 26%,transparent)}
.ans-agent-head{display:flex;align-items:center;gap:8px;min-width:0}
.ans-icon{width:15px;height:15px;flex:none}
.ans-agent-glyph{color:var(--hue);width:16px;height:16px;filter:drop-shadow(0 0 6px color-mix(in srgb,var(--hue) 55%,transparent))}
.ans-agent-name{font-size:13.5px;font-weight:700;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ans-agent-head .ans-agent-state{margin-left:auto;display:inline-flex;align-items:center}
.ans-agent-head .ans-dot{margin-left:auto}
.ans-agent-metric{display:flex;align-items:baseline;gap:6px;min-width:0}
.ans-agent-metric b{font-size:24px;font-weight:700;letter-spacing:.2px;font-variant-numeric:tabular-nums;line-height:1.15}
.ans-agent-metric small{font-size:11.5px;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ans-agent-foot{font-size:11.5px;color:var(--text-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* KPI */
.ans-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.ans-kpis.is-flat{grid-template-columns:repeat(4,minmax(0,1fr))}
.ans-kpi{background:var(--bg-panel);border:1px solid var(--border);border-radius:13px;padding:12px 14px;min-width:0;
  display:flex;flex-direction:column;gap:2px}
.ans-kpi-label{font-size:11.5px;color:var(--text-dim)}
.ans-kpi-value{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--hue,var(--text))}
.ans-kpi-sub{font-size:11px;color:var(--text-faint)}

/* 卡片 */
.ans-card{border:1px solid var(--border);border-radius:16px;background:var(--bg-panel);min-width:0;overflow:hidden}
.ans-card-head{display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:1px solid var(--border)}
.ans-card-head h3{margin:0;font-size:12.5px;font-weight:600;letter-spacing:.3px;color:#CBD6E3}
.ans-card-right{margin-left:auto;display:flex;align-items:center;gap:8px}
.ans-card-body{padding:13px 14px;display:flex;flex-direction:column;gap:10px;min-width:0}
.ans-meta{font-size:11px;color:var(--text-faint)}
.ans-hint{margin:0;font-size:12px;line-height:1.7;color:var(--text-dim)}
.ans-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ans-row.align-start{align-items:stretch}
.ans-grow{flex:1 1 auto;min-width:0}
.ans-grow-0{flex:0 0 clamp(280px,34%,420px);min-width:0}
.ans-two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}

.ans-chip{display:inline-flex;align-items:center;height:19px;padding:0 7px;border-radius:9px;font-size:10.5px;
  border:1px solid var(--border);color:var(--text-dim);white-space:nowrap}
.ans-chip.ok{border-color:rgba(62,213,152,.35);background:rgba(62,213,152,.10);color:var(--ok)}
.ans-chip.warn{border-color:rgba(245,185,66,.35);background:rgba(245,185,66,.10);color:var(--warn)}

.ans-empty{display:flex;flex-direction:column;gap:6px;padding:6px 2px}
.ans-empty-title{margin:0;font-size:13px;font-weight:600}
.ans-empty-body{margin:0;font-size:12px;line-height:1.7;color:var(--text-dim);max-width:78ch}
.ans-empty-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}

/* 数据健康 / 日志 */
.ans-health{display:flex;flex-direction:column;gap:6px}
.ans-health-row{display:flex;align-items:center;gap:9px;font-size:12.5px;padding:5px 0;border-bottom:1px dashed rgba(255,255,255,.05)}
.ans-health-row:last-child{border-bottom:0}
.ans-health-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ans-health-module{color:var(--text-faint);font-size:11px}
.ans-health-time{margin-left:auto;color:var(--text-dim);font-size:11.5px;white-space:nowrap;font-variant-numeric:tabular-nums}

.ans-log{display:flex;flex-direction:column;gap:4px;font-variant-numeric:tabular-nums}
.ans-log-row{display:grid;grid-template-columns:118px 56px minmax(0,1fr) auto;gap:10px;align-items:center;
  font-size:12px;padding:5px 8px;border-radius:8px}
.ans-log-row:hover{background:rgba(255,90,31,.06)}
.ans-log-t{color:var(--text-faint)}
.ans-log-who{color:#8FD8FF;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ans-log-msg{color:var(--text);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ans-log-hash{font-size:10.5px;color:var(--text-faint);font-family:ui-monospace,Menlo,Consolas,monospace}

/* Agent 详情 */
.ans-pagehead{display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap}
.ans-pagehead h1{margin:0;font-size:19px;font-weight:700}
.ans-pagehead-actions{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}
.ans-agenthero{display:flex;flex-direction:column;gap:14px;padding:16px;border-radius:18px;
  border:1px solid color-mix(in srgb,var(--hue) 30%,var(--border));
  background:radial-gradient(600px 220px at 8% 0,color-mix(in srgb,var(--hue) 12%,transparent),transparent 70%),var(--bg-panel)}
.ans-agenthero-head{display:flex;align-items:center;gap:12px}
.ans-agenthero-glyph{width:26px;height:26px;color:var(--hue);filter:drop-shadow(0 0 10px color-mix(in srgb,var(--hue) 60%,transparent))}
.ans-agenthero-main{display:flex;flex-direction:column;min-width:0}
.ans-agenthero-main b{font-size:17px;font-weight:700}
.ans-agenthero-main small{font-size:12px;color:var(--text-dim)}
.ans-agenthero-state{margin-left:auto;display:flex;align-items:center;gap:7px;font-size:12px;color:var(--text-dim)}
.ans-agenthero-brief{margin:-4px 0 0;font-size:12.5px;line-height:1.7;color:var(--text-dim)}

/* 柱图 */
.ans-days{display:flex;flex-direction:column;gap:8px}
.ans-days-plot{display:grid;grid-template-columns:repeat(14,minmax(0,1fr));gap:4px;align-items:end;height:132px;
  border-bottom:1px solid rgba(255,255,255,.07);padding-bottom:2px}
.ans-day{position:relative;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;gap:2px}
.ans-day-value{font-size:9.5px;color:var(--text-dim);font-variant-numeric:tabular-nums}
.ans-day-bar{width:56%;max-width:16px;min-height:5px;border-radius:3px 3px 1px 1px;
  background:linear-gradient(180deg,color-mix(in srgb,var(--hue) 90%,#fff 8%),color-mix(in srgb,var(--hue) 60%,transparent));
  box-shadow:0 0 6px color-mix(in srgb,var(--hue) 22%,transparent);opacity:.72}
.ans-day-bar.is-null{min-height:100%;background:transparent;border:0;border-left:1px dashed rgba(255,255,255,.06);
  box-shadow:none;border-radius:0;opacity:1}
.ans-day-bar.is-today{background:linear-gradient(180deg,#FF7A7C,rgba(255,77,79,.45));box-shadow:0 0 10px rgba(255,77,79,.3)}
.ans-day-bar.is-today.is-null{background:transparent;box-shadow:none;border-left-color:rgba(255,77,79,.35)}
.ans-day-bar.is-zero{height:3px!important;min-height:3px;opacity:.35;background:rgba(255,255,255,.18);box-shadow:none}
.ans-day-bar.is-today{background:linear-gradient(180deg,#FF7A7C,rgba(255,77,79,.45));box-shadow:0 0 10px rgba(255,77,79,.3)}
.ans-day-bar.is-future{min-height:100%;background:transparent;border:1px dashed rgba(255,255,255,.14);box-shadow:none;border-radius:6px}
.ans-days-axis{display:grid;grid-template-columns:repeat(14,minmax(0,1fr));gap:4px}
.ans-days-axis span{display:flex;flex-direction:column;align-items:center;gap:0;font-size:10px;color:var(--text-faint);line-height:1.3}
.ans-days-axis b{font-weight:600;font-size:11px}
.ans-days-axis .is-today b{color:var(--danger)}

/* 数据源 */
.ans-src-list{display:flex;flex-direction:column;gap:6px}
.ans-src{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:11px;background:rgba(255,255,255,.02);
  border:1px solid rgba(255,255,255,.05)}
.ans-src-main{display:flex;flex-direction:column;min-width:0}
.ans-src-main b{font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ans-src-main small{font-size:11px;color:var(--text-faint)}
.ans-src-side{margin-left:auto;display:flex;flex-direction:column;align-items:flex-end}
.ans-src-side b{font-size:12.5px;font-variant-numeric:tabular-nums}
.ans-src-side small{font-size:10.5px;color:var(--text-faint)}
.ans-scroll{overflow-x:auto}
.ans-table{width:100%;border-collapse:collapse;font-size:12.5px;min-width:640px}
.ans-table th{text-align:left;font-size:11px;font-weight:600;color:var(--text-dim);padding:8px 10px;border-bottom:1px solid var(--border)}
.ans-table td{padding:9px 10px;border-bottom:1px solid rgba(255,255,255,.04);white-space:nowrap}
.ans-table td small{color:var(--text-faint);font-size:10.5px}
.ans-table tr:last-child td{border-bottom:0}

/* 动作 */
.ans-actions{display:flex;gap:8px;flex-wrap:wrap}
.ans-action{display:inline-flex;align-items:center;gap:7px;padding:5px 9px;border-radius:9px;font-size:12px;
  border:1px dashed rgba(255,255,255,.14);color:var(--text-dim)}
.ans-action small{font-size:10.5px;color:var(--text-faint)}
.ans-action .lv{font-style:normal;font-size:10px;font-weight:700;padding:1px 5px;border-radius:5px}
.ans-action .lv.R1{background:rgba(62,213,152,.12);color:var(--ok)}
.ans-action .lv.R2{background:rgba(245,185,66,.14);color:var(--warn)}
.ans-action .lv.R3{background:rgba(255,77,79,.14);color:var(--danger)}

/* 待办 */
.ans-filters{display:flex;gap:6px;flex-wrap:wrap}
.ans-filter{appearance:none;display:inline-flex;align-items:center;gap:6px;height:27px;padding:0 11px;border-radius:14px;
  border:1px solid var(--border);background:transparent;color:var(--text-dim);font-size:12px;cursor:pointer}
.ans-filter:hover{color:var(--text)}
.ans-filter.on{background:rgba(255,90,31,.14);border-color:rgba(255,90,31,.38);color:#FF9A6A}
.ans-filter-count{font-size:10.5px;color:inherit;opacity:.85}
.ans-todos{display:flex;flex-direction:column;gap:10px}
.ans-todo{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;background:var(--bg-panel);
  border:1px solid var(--border);border-radius:14px}
.ans-lv-chip{flex:none;font-size:11px;font-weight:700;padding:3px 7px;border-radius:6px;line-height:1.2}
.ans-lv-chip.R1{background:rgba(62,213,152,.12);color:var(--ok);border:1px solid rgba(62,213,152,.3)}
.ans-lv-chip.R2{background:rgba(245,185,66,.12);color:var(--warn);border:1px solid rgba(245,185,66,.3)}
.ans-lv-chip.R3{background:rgba(255,77,79,.14);color:var(--danger);border:1px solid rgba(255,77,79,.35)}
.ans-todo-main{flex:1;min-width:0}
.ans-todo-title{font-size:13px;font-weight:600}
.ans-todo-sub{font-size:12px;color:var(--text-dim);margin-top:3px;line-height:1.6}
.ans-todo-meta{font-size:11px;color:var(--text-faint);margin-top:4px;font-variant-numeric:tabular-nums}
.ans-todo-detail{margin-top:8px;padding:9px 10px;border-radius:10px;background:rgba(255,255,255,.03)}
.ans-todo-detail p{margin:0 0 4px;font-size:12px;color:var(--text-dim)}
.ans-todo-actions{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap}

.ans-kv{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 18px;margin:0}
.ans-kv div{display:flex;flex-direction:column;gap:2px;min-width:0}
.ans-kv dt{margin:0;font-size:11px;color:var(--text-faint)}
.ans-kv dd{margin:0;font-size:12.5px;font-variant-numeric:tabular-nums}
.ans-bullets{margin:0;padding-left:16px;display:flex;flex-direction:column;gap:6px;font-size:12px;line-height:1.7;color:var(--text-dim)}
.ans-toast-inline{font-size:11.5px;color:var(--ok)}

/* 会话抽屉 */
.ans-chat{flex:none;width:clamp(320px,34%,440px);display:flex;flex-direction:column;min-height:0;
  border-left:1px solid var(--border);background:#080D13}
.ans-chat-head{flex:none;display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--border)}
.ans-chat-head>div{display:flex;flex-direction:column;min-width:0}
.ans-chat-head b{font-size:12.5px}
.ans-chat-head small{font-size:10.5px;color:var(--text-faint)}
.ans-icon-btn{margin-left:auto;width:26px;height:26px;border-radius:8px;border:1px solid var(--border);background:transparent;
  color:var(--text-dim);cursor:pointer;font-size:15px;line-height:1}
.ans-icon-btn:hover{color:var(--text)}
.ans-chat-body{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.ans-chat-node{display:flex;flex:1;min-height:0;min-width:0}
.ans-chat-empty{padding:16px;display:flex;flex-direction:column;gap:8px}

/* 页脚 / toast */
.ans-foot{flex:none;padding:6px 16px;border-top:1px solid var(--border);font-size:11px;color:var(--text-faint);
  font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ans-toast{position:absolute;left:50%;bottom:34px;transform:translateX(-50%);padding:7px 14px;border-radius:10px;
  background:#121A24;border:1px solid var(--border-strong);color:var(--text);font-size:12px;
  box-shadow:0 10px 30px rgba(0,0,0,.5);z-index:9}

@container (max-width:1180px){
  .ans-kpis,.ans-kpis.is-flat{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ans-agents{grid-template-columns:repeat(3,minmax(0,1fr));padding-top:20px}
  .ans-grow-0{flex:1 1 100%}
  .ans-wires{display:none}
  .ans-lane::before{display:none}
}
@container (max-width:900px){
  .ans-two{grid-template-columns:1fr}
  .ans-brand-text small{display:none}
}
@container (max-width:720px){
  .ans-agents{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ans-live,.ans-clock{display:none}
  .ans-main{padding:12px}
  .ans-founder,.ans-ceo{max-width:100%}
  .ans-log-row{grid-template-columns:1fr;gap:1px}
  .ans-chat{width:56%}
}
@container (max-width:520px){
  .ans-agents,.ans-kpis,.ans-kpis.is-flat{grid-template-columns:1fr}
  .ans-days-plot{height:96px}
}
`

    // ── 注册 ─────────────────────────────────────────────────

    function apply(ctx) {
      const workbenches = ctx.desktopWorkbenches
      if (!workbenches || typeof workbenches.register !== 'function') {
        try { console.info('[agent-new-media-studio] 没有 desktopWorkbenches 服务：当前不是 Desktop 工作台宿主，面板不注册。') } catch { /* 忽略 */ }
        return
      }

      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.dshPlugin = 'dsh-agent-new-media-studio'
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'agent-new-media-studio: styles')

      ctx.effect(() => workbenches.register({
        title: 'Agent New Media Studio',
        repository: REPOSITORY,
        description: '一人公司经营工作台：创始人 → CEO → 6 路 Agent 的树状拓扑，数据快照驱动红黄绿灯，建议必须过决策收件箱。',
        panelTitle: '经营看板',
        icon: '◈',
        audience: '一人公司 / 自媒体经营者',
        customFrame: true,
        headerLayout: 'compact',
      }, App), 'agent-new-media-studio: register')
    }

    return { apply, inject: ['desktopWorkbenches', 'sessions'] }
  },
})
