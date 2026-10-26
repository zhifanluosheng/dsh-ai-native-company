// 模块描述符：加模块 = 加一个 descriptor + 数据适配器 + Agent preset，
// 不改核心状态机、审批和看板。Phase 0 只启用 content，其余留 planned 空壳。

export const MODULES = [
  {
    id: 'content',
    name: '内容',
    glyph: '文',
    tagline: '选题、发布、72 小时复盘',
    phase: 'active',
    primaryMetric: { key: 'views', label: '播放', unit: '次', aggregation: 'sum' },
    freshness: { expectedEveryHours: 24, warnAfterHours: 30, blockAfterHours: 72 },
    sources: [
      { id: 'douyin-main', name: '抖音大号', kind: 'csv', cadenceHours: 24 },
      { id: 'bilibili', name: 'B 站', kind: 'csv', cadenceHours: 24 },
      { id: 'xiaohongshu', name: '小红书', kind: 'csv', cadenceHours: 24 },
    ],
    metrics: [
      { key: 'views', label: '播放', unit: '次', aggregation: 'sum' },
      { key: 'completion_rate', label: '完播率', unit: '%', aggregation: 'weighted_mean' },
      { key: 'engagement_rate', label: '互动率', unit: '%', aggregation: 'weighted_mean' },
    ],
    anomalyRules: [
      { id: 'completion-drop', metric: 'completion_rate', compare: 'same_weekday_4w', threshold: -0.15, minSamples: 8, severity: 'high' },
    ],
    actions: [
      { id: 'rewrite-hook', label: '改写开头 3 秒', risk: 'R1', executor: 'agent' },
      { id: 'change-cover', label: '更换封面', risk: 'R2', executor: 'agent+approval' },
      { id: 'publish', label: '发布', risk: 'R3', executor: 'human' },
    ],
  },
  {
    id: 'ecommerce',
    name: '电商',
    glyph: '商',
    tagline: '销量、转化、库存',
    phase: 'planned',
    primaryMetric: { key: 'revenue', label: '销售额', unit: '¥', aggregation: 'sum' },
    freshness: { expectedEveryHours: 12, warnAfterHours: 18, blockAfterHours: 48 },
    sources: [
      { id: 'amazon-store', name: '亚马逊店铺', kind: 'csv', cadenceHours: 12 },
    ],
    metrics: [
      { key: 'revenue', label: '销售额', unit: '¥', aggregation: 'sum' },
      { key: 'orders', label: '订单', unit: '单', aggregation: 'sum' },
      { key: 'conversion', label: '转化率', unit: '%', aggregation: 'weighted_mean' },
    ],
    anomalyRules: [],
    actions: [
      { id: 'edit-listing', label: '改标题 / 五点', risk: 'R2', executor: 'agent+approval' },
      { id: 'adjust-price', label: '调价', risk: 'R2', executor: 'agent+approval' },
      { id: 'launch-sku', label: '上架新 SKU', risk: 'R3', executor: 'human' },
    ],
  },
  {
    id: 'opensource',
    name: '开源',
    glyph: '源',
    tagline: 'star、issue、PR 节奏',
    phase: 'planned',
    primaryMetric: { key: 'stars', label: 'Star', unit: '个', aggregation: 'sum' },
    freshness: { expectedEveryHours: 24, warnAfterHours: 30, blockAfterHours: 96 },
    sources: [
      { id: 'github-repo', name: 'GitHub 仓库', kind: 'api', cadenceHours: 24 },
    ],
    metrics: [
      { key: 'stars', label: 'Star', unit: '个', aggregation: 'sum' },
      { key: 'issues_open', label: '未关闭 issue', unit: '个', aggregation: 'last' },
      { key: 'pr_merged', label: '合并 PR', unit: '个', aggregation: 'sum' },
    ],
    anomalyRules: [],
    actions: [
      { id: 'reply-issue', label: '回复 issue', risk: 'R1', executor: 'agent' },
      { id: 'release', label: '发版本', risk: 'R3', executor: 'human' },
    ],
  },
  {
    id: 'invest',
    name: '投资',
    glyph: '投',
    tagline: '持仓、成本、纪律',
    phase: 'planned',
    primaryMetric: { key: 'position_value', label: '持仓市值', unit: '¥', aggregation: 'last' },
    freshness: { expectedEveryHours: 24, warnAfterHours: 48, blockAfterHours: 120 },
    sources: [
      { id: 'portfolio', name: '持仓表', kind: 'csv', cadenceHours: 24 },
    ],
    metrics: [
      { key: 'position_value', label: '持仓市值', unit: '¥', aggregation: 'last' },
      { key: 'pnl_pct', label: '浮盈亏', unit: '%', aggregation: 'last' },
    ],
    anomalyRules: [],
    actions: [
      { id: 'rebalance-plan', label: '再平衡计划', risk: 'R2', executor: 'agent+approval' },
      { id: 'trade', label: '买入 / 卖出', risk: 'R3', executor: 'human' },
    ],
  },
  {
    id: 'knowledge',
    name: '知识库',
    glyph: '知',
    tagline: '沉淀、检索、反哺决策',
    phase: 'planned',
    primaryMetric: { key: 'docs', label: '文档', unit: '篇', aggregation: 'sum' },
    freshness: { expectedEveryHours: 168, warnAfterHours: 240, blockAfterHours: 720 },
    sources: [],
    metrics: [],
    anomalyRules: [],
    actions: [{ id: 'write-doc', label: '写复盘', risk: 'R1', executor: 'agent' }],
  },
  {
    id: 'assistant',
    name: '助理',
    glyph: '助',
    tagline: '日程、待办、对外沟通',
    phase: 'planned',
    primaryMetric: { key: 'open_items', label: '未完成事项', unit: '项', aggregation: 'last' },
    freshness: { expectedEveryHours: 24, warnAfterHours: 48, blockAfterHours: 120 },
    sources: [],
    metrics: [],
    anomalyRules: [],
    actions: [{ id: 'draft-reply', label: '起草回复', risk: 'R2', executor: 'agent+approval' }],
  },
]

export const MODULE_BY_ID = new Map(MODULES.map((item) => [item.id, item]))

export const RISK_LABEL = { R1: '可回滚', R2: '需审批', R3: '需双确认' }
