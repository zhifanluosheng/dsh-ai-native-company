# AI Native 一人公司 · DSH 工作台插件设计

> 版本：v0.1 · 2026-10-25  
> 目标：把“CEO Agent + 六个业务 Agent + 老板拍板”从一张架构图，变成 DSH Desktop 里每天真的会用的工作台。  
> 依据：DSH Desktop 工作台开发规范（2026-10-12）、DSH 0.2.x 插件 / Agent / Schedule / Credentials 接口、你的《AI Native 一人公司系统》整理稿，以及现有的 `dsh-ai-native-solo` 原型。  
> 状态：设计稿。确认第 13 节的 3 个决策后，进入脚手架和 MVP。

---

## 0. 一句话结论

**不要另起一个 FastAPI + PostgreSQL + Redis + LangGraph 的系统。**  
把它做成一个 **DSH Desktop 工作台插件**：DSH 提供模型、Agent 循环、工具、会话、审批、沙箱、定时器和 UI 宿主；插件只负责“经营逻辑 + 数据 + 状态机 + 看板”。

核心不是“七个 Agent 常驻”，而是：

> **数据可信 → 判断可解释 → 决策可追责 → 执行有边界 → 结果可测量**

“CEO Agent”是一个**角色 + 编排器**，不是第七个后台进程；“业务 Agent”是**按需启动的岗位会话**，不是七个 24 小时空转的服务。

---

## 1. 先把需求翻译对

你写的架构没有错，但它描述的是“一个公司里有什么”。真正决定项目成败的是下面五个工程问题：

| 你写的 | 真正要解决的问题 | 设计回应 |
|---|---|---|
| CEO 看板 / 数据展示 | 老板每天只有几分钟，需要的不是图，是**今天该做什么决定** | 决策收件箱优先，图表服务于证据 |
| 六个业务 Agent | 不是六个聊天机器人，是六个**有交付物、有权限边界、有验收标准**的岗位 | 角色定义 + 按需子 Agent + 结构化结果 |
| AI 自动派活 / 执行 | 模型不能既当运动员又当裁判 | 确定性状态机 + 人工审批 + 能力令牌 |
| 知识库自动沉淀 | 不是把聊天记录倒进向量库 | 只沉淀“决策—证据—结果—复盘”的结构化记忆 |
| 每天定时汇报 | 汇报太多会变成噪音 | 每小时**巡检**，有变化才叫 CEO；日报只讲 3 件事 |
| 接入真实数据源 | 这是整个项目最长的坡 | CSV / 手动导入先跑通闭环，API 适配器后置 |

### 1.1 三个硬性前提，翻译成代码约束

| 前提 | 代码约束 |
|---|---|
| 必须有客观数据 | 没有 `snapshot` 就没有 `observation`；没有 `evidence_ref` 就没有 `decision`；数据过期则禁止生成新建议 |
| 建议形成要被管理 | AI 的输出只能写入 `observations` / `decisions`，不能直接写 `tasks`；决策有版本、状态、过期时间 |
| 关键决策必须由人拍板 | 审批端点只对 UI 开放，模型没有 `approve` 工具；执行需要绑定审批的能力令牌 |

### 1.2 MVP 不做什么

- 不做多用户、组织权限、团队协作。
- 不做公网部署、手机 App、远程登录。
- 不做自动交易、自动上架、自动合并 PR。
- 不做全平台 API 对接；第一版只做 CSV / 手动录入。
- 不做向量数据库；先用 SQLite FTS5 + 结构化链接。
- 不做“七个 Agent 常驻值班”；先做 CEO + 一个业务模块。

---

## 2. 技术路线：原方案 → DSH 映射

| 原方案 | DSH 方案 | 决策理由 |
|---|---|---|
| React + Tailwind 独立前端 | 工作台客户端单文件 React 模块，`desktopWorkbenches.register()` | 宿主负责侧栏、模式切换、会话归属，插件不复制聊天界面 |
| FastAPI / API 网关 | Host 插件 `ctx.webServer.register()`，路由 `/api/ai-company/*` | 不新增第二个服务、不新增第二个端口、不重复鉴权 |
| LangGraph 工作流 | 自研**确定性状态机**（JS），AI 只在节点内提供判断 | 经营流程需要可审计、可重试、可人工暂停；图框架不是必需 |
| CEO Agent 服务 | CEO 角色会话 + 巡检 / 简报编排器 | 模型负责解释和建议，状态迁移由代码负责 |
| 六个业务 Agent 服务 | 模块描述符 + Agent preset + 按需 subagent | Agent 是会话，不是常驻进程；避免空转和 token 浪费 |
| PostgreSQL | SQLite（单文件，WAL） | 单用户本地应用，够用、可备份、零运维 |
| Redis + Celery | 插件内定时器 + 持久化任务表 + DSH jobs（长任务） | 不需要独立消息队列；重启可恢复 |
| pgvector / Chroma | SQLite FTS5 + 结构化知识表 | 先解决“找得到、引得准”，再考虑语义检索 |
| Docker + VPS | DSH Desktop 本地运行 | 管理端口不出回环，避免 3080 暴露的整类风险 |
| Opus 5.5 固定模型 | 按角色配置 provider/model，敏感模块可限定本地模型 | 成本、隐私、可用性分开控制 |

### 2.1 为什么不做独立后端

1. **重复安全边界**：DSH 已经有本地管理端口、审批、沙箱、会话日志。再起一个 FastAPI，就要再做一遍认证、CSRF、密钥管理、审计。
2. **重复 Agent 运行时**：模型调用、工具调用、重试、上下文压缩、子 Agent、会话持久化，DSH 已经提供。
3. **数据分裂**：独立后端会把“决策”和“会话轨迹”分成两套日志，出事时无法回放。
4. **部署成本**：单用户项目不需要 Docker + VPS；本地 SQLite + Desktop 更稳。

> 结论：**DSH 是运行时，工作台是驾驶舱。** 不要造第二套运行时。

---

## 3. 总体架构

```text
┌──────────────────────────────────────────────────────────────────────┐
│ 表现层：DSH Desktop 工作台（React 单文件，customFrame）               │
│ 总览 · 决策收件箱 · 任务 · 模块 · 数据源 · 知识 · AI 工作 · 设置       │
└───────────────────────────────▲──────────────────────────────────────┘
                                │ 本机 JSON API（仅回环，同源，自定义头）
┌───────────────────────────────┴──────────────────────────────────────┐
│ 经营控制面：Host 插件（dsh/index.js）                                 │
│                                                                      │
│  Module Registry   Policy Engine   State Machine   Audit Log         │
│  Sweep 巡检        Brief 简报      Dispatch 派活   Verify 验收        │
│  Measure 回数据    Scheduler       Source Adapters   Knowledge       │
│                                                                      │
│  业务库：SQLite（WAL）  证据文件：snapshots/  审计：audit.jsonl        │
└───────────────┬───────────────────────────────┬──────────────────────┘
                │ 只读工具 / 提议工具            │ 任务简报 / 结构化结果
┌───────────────▼──────────────┐   ┌────────────▼──────────────────────┐
│ CEO 角色会话                  │   │ 模块 Agent（按需启动）             │
│ 汇总、解释、提出决策、验收建议 │   │ 内容 / 电商 / 开源 / 投资 / 知识 / 助理 │
└──────────────────────────────┘   └───────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────────────┐
│ 数据面：CSV / 手动 / API Adapter → 不可变 Snapshot → 规范化 Metrics    │
│ 外部内容一律视为不可信数据；进入模型前做来源标注、清洗、脱敏、隔离     │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.1 三个平面，一条闭环

| 平面 | 负责 | 不负责 |
|---|---|---|
| 表现层 | 让人看见、让人拍板、让人干预 | 不做业务计算、不直接执行外部动作 |
| 控制面 | 状态、规则、证据、审批、审计、调度 | 不做开放域推理 |
| AI 平面 | 诊断、归因、写方案、写草稿、验收建议 | 不改状态、不审批、不直接对外执行 |
| 数据面 | 采集、快照、规范化、质量检查 | 不做建议、不做决策 |

闭环：

```text
接数据 → 看数据 → 发现变化 → 形成判断 → CEO 简报 → 老板拍板
   ↑                                                   ↓
   └── 回数据测效果 ← 验收 ← Agent 执行 ← CEO 派活 ←──┘
```

每一步都有数据库记录、状态和责任人；不是一条“聊天链”。

---

## 4. 五个硬约束的工程实现

### 4.1 证据链：没有证据，不许建议

**数据模型**

- `snapshots`：一次采集的不可变快照，含 `source_id`、`captured_at`、`period`、`raw_path`、`sha256`、`row_count`。
- `metrics`：从快照规范化出来的指标，含 `snapshot_id`、`metric_key`、`value`、`unit`、`dimensions`（JSON）。
- `observations`：由规则或模型发现的变化，含 `evidence`（快照 + 指标 + 维度 + 计算式）、`severity`、`confidence`。
- `decisions`：必须至少引用一个 `observation`，而每个 observation 必须能追到 snapshot。

**校验规则**

1. 创建 decision 时，服务端重新解析 `evidence_refs`，确认快照存在、指标存在、数值一致。
2. 不允许只引用“模型说”“上周好像”；必须引用 `snapshot_id`。
3. 归因必须标注等级：

| 等级 | 证据 | 可以说 |
|---|---|---|
| L1 相关 | 两个指标同时变化 | “同时发生了” |
| L2 时序 | 变化发生在动作之后 | “可能相关” |
| L3 分层 | 其他维度稳定，只有目标维度变化 | “更可能是这个原因” |
| L4 实验 | A/B 或回滚实验 | “可以确认” |

没有 L3/L4，不许写“因为图片问题导致转化下降”；只能写“疑似，建议做 3 天回滚实验”。

### 4.2 权限与审批：模型没有“同意”按钮

**风险分级**

| 级别 | 例子 | 默认策略 |
|---|---|---|
| R0 只读 | 看数据、查知识、生成分析 | 自动 |
| R1 草稿 | 写文案、出图、生成标题、准备 CSV | 自动，但产物进草稿区 |
| R2 外部可逆 | 改商品图、改标题、发草稿、开 PR（不合并） | 必须人工审批 |
| R3 高风险 | 上架、定价、合并 PR、交易、删除数据 | 双确认 + 输入确认短语 + 短时有效 |

**执行边界**

- 决策审批通过后，服务端生成一个**能力令牌**：
  - 绑定 `decision_id`、`task_id`、`action_id`、`params_hash`、`expires_at`。
  - Agent 只能凭令牌执行完全相同的参数；改一个字段就失效。
  - 令牌一次性使用；失败重试需要重新签发。
- 外部动作统一走 `ActionExecutor`：
  - 先 `dryRun()`，展示将发生什么。
  - 再 `execute()`，记录请求/响应/外部 ID。
  - 能回滚的提供 `rollback()`；不能回滚的必须 R3。
- 业务 Agent 默认**不授予 shell、不授予通用 web fetch**；需要外部动作时，只能调用 `request_action` 工具，由控制面走审批。

**为什么审批端点不能只靠提示词**

模型可以被注入、可以被诱导；所以“不能审批”必须是**能力缺失**，不是“系统提示里写了不要”。审批接口只注册给 UI，模型工具表里根本没有 `approve_decision`。

### 4.3 闭环测量：每个动作都要有“回数据”

`tasks` 表必须有：

- `measure_metric`：用哪个指标判断成败。
- `baseline_value`：动作前基线。
- `target_value`：目标。
- `measure_at`：什么时候回来看。
- `measure_window_days`：观察窗口。
- `outcome_verdict`：`improved / no_change / worse / unmeasured`。

到点后由 `MeasureJob` 自动拉新数据、计算差值、写入 `outcomes`，并把结论回灌知识库。  
如果数据没回来，结论只能是 `unmeasured`，不能写“已完成，效果良好”。

### 4.4 建议管理：AI 的话必须“入库”

- AI 输出只能落到两张表：`observations`（发现）和 `decisions`（建议）。
- 不允许 AI 直接创建 `tasks`；任务只能由已批准的 decision 派生。
- 每条 decision 有 `version`；已批准的 decision 不可编辑，修改必须新建版本并重新审批。
- 被驳回的 decision 进入 `rejected`，14 天内没有新证据不得重复提议。
- 每天最多 3 条待拍板 decision；超出的进入“观察池”，避免决策疲劳。
- 聊天只用于解释和追问；**聊天里说的建议不算数**，必须落库。

### 4.5 数据新鲜度：黄灯不是装饰

每个数据源配置：

```json
{
  "expectedEveryHours": 24,
  "warnAfterHours": 30,
  "blockAfterHours": 72
}
```

| 状态 | 条件 | 系统行为 |
|---|---|---|
| 绿 | 最近一次成功在 `warnAfterHours` 内 | 正常分析与建议 |
| 黄 | 超过 warn，未超过 block | 可看数据；新建议标注“数据偏旧”；不自动派活 |
| 红 | 超过 block 或连续失败 3 次 | 禁止生成新 decision；只生成“数据缺口”待办；已有 decision 暂停派活 |

审批通过但数据已过期的 decision，在派活前必须重新校验；过期则回到 `pending` 并提示刷新。

---

## 5. 领域模型

### 5.1 模块描述符：加模块不改核心

每个业务模块是一个 `ModuleDescriptor`，不是一段硬编码逻辑。

```js
export const contentModule = {
  id: 'content',
  name: '内容',
  icon: 'content',
  primaryMetric: 'views_7d',
  freshness: { expectedEveryHours: 24, warnAfterHours: 30, blockAfterHours: 72 },

  sources: [
    { id: 'douyin-main', name: '抖音大号', kind: 'csv', cadence: 'daily' },
    { id: 'bilibili', name: 'B站', kind: 'csv', cadence: 'daily' },
  ],

  metrics: [
    { key: 'views', label: '播放', unit: '次', aggregation: 'sum' },
    { key: 'completion_rate', label: '完播率', unit: '%', aggregation: 'weighted_mean' },
    { key: 'engagement_rate', label: '互动率', unit: '%', aggregation: 'weighted_mean' },
  ],

  anomalyRules: [
    {
      id: 'completion-drop',
      metric: 'completion_rate',
      compare: 'same_weekday_4w',
      threshold: -0.15,
      minSamples: 8,
      severity: 'high',
    },
  ],

  actions: [
    { id: 'rewrite-hook', label: '改写开头 3 秒', risk: 'R1', executor: 'agent' },
    { id: 'change-cover', label: '更换封面', risk: 'R2', executor: 'agent+approval' },
    { id: 'publish', label: '发布', risk: 'R3', executor: 'human' },
  ],

  agent: {
    preset: 'content-operator',
    tools: ['company_module_detail', 'company_knowledge_search', 'company_submit_task_result'],
    forbidden: ['publish', 'delete', 'shell', 'web_fetch'],
  },
}
```

新增模块 = 新增 descriptor + 数据适配器 + Agent preset。核心状态机、审批、看板全部复用。

### 5.2 决策状态机

```text
draft ──► pending ──► approved ──► dispatched ──► executing
  ▲          │            │                          │
  │          │            └──► expired               ▼
  │          ├──► rejected                      submitted
  │          └──► changes_requested ──► draft         │
  │                                                   ▼
  └──────────────────────────────────────────── verifying
                                                      │
                                              verified ─┴─► measuring ──► closed
                                                      │
                                                      └──► failed ──► retry / abandoned
```

**不变量**

1. 只有 `pending` 能被审批。
2. 审批是幂等的；重复提交返回同一结果。
3. 没有 `approved` 的 decision，不能创建 task。
4. task 执行前必须校验能力令牌和证据新鲜度。
5. 验收人不能是执行该任务的同一个 Agent。
6. `closed` 必须有 outcome，或明确记录 `unmeasured` 及原因。
7. 每个状态迁移和审计事件在同一个事务里写入。

### 5.3 任务状态机

```text
queued ──► running ──► submitted ──► verifying ──► verified ──► measuring ──► closed
   │           │            │
   │           ├──► blocked（缺输入 / 等审批 / 等数据）
   │           └──► failed ──► retry（最多 1 次）──► abandoned
   └──► cancelled
```

`blocked` 必须写原因和解除条件；不允许“静默卡住”。

### 5.4 核心表

> 目标库：SQLite，WAL 模式。`snapshots/` 存原始文件；数据库存规范化和索引。  
> `node:sqlite`（Node 24）优先；若 Desktop 运行时不暴露，退 DSH 已随附的 `better-sqlite3`，再退 `sql.js`。第一天做 spike 验证。

```sql
-- 模块与数据源
CREATE TABLE modules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL REFERENCES modules(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL,              -- csv | manual | api
  secret_ref TEXT,                 -- 只存引用，不存密钥
  cadence_hours INTEGER NOT NULL,
  warn_after_hours INTEGER NOT NULL,
  block_after_hours INTEGER NOT NULL,
  last_run_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  status TEXT NOT NULL DEFAULT 'unknown',  -- green | yellow | red
  config_json TEXT NOT NULL
);

-- 不可变快照与指标
CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  captured_at TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  raw_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  quality_score REAL,
  quality_json TEXT,
  UNIQUE(source_id, sha256)
);

CREATE TABLE metrics (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES snapshots(id),
  module_id TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT,
  dimensions_json TEXT,
  period_start TEXT,
  period_end TEXT
);
CREATE INDEX idx_metrics_lookup ON metrics(module_id, metric_key, period_end);

-- 发现与简报
CREATE TABLE observations (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL,
  kind TEXT NOT NULL,              -- anomaly | trend | opportunity | data_gap | quality
  severity TEXT NOT NULL,          -- low | medium | high | critical
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  evidence_json TEXT NOT NULL,     -- [{snapshotId, metricKey, value, baseline, query}]
  fingerprint TEXT NOT NULL,
  confidence REAL,
  status TEXT NOT NULL DEFAULT 'open', -- open | promoted | dismissed | expired
  detected_at TEXT NOT NULL,
  UNIQUE(module_id, fingerprint)
);

CREATE TABLE briefs (
  id TEXT PRIMARY KEY,
  brief_date TEXT NOT NULL,
  version INTEGER NOT NULL,
  summary TEXT NOT NULL,
  body_json TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  model TEXT,
  prompt_hash TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(brief_date, version)
);

-- 决策
CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL,
  brief_id TEXT,
  title TEXT NOT NULL,
  diagnosis TEXT NOT NULL,
  options_json TEXT NOT NULL,
  recommendation TEXT,
  risk_level TEXT NOT NULL,        -- R1 | R2 | R3
  status TEXT NOT NULL,            -- draft | pending | approved | rejected | changes_requested | expired | dispatched | executing | submitted | verified | closed
  version INTEGER NOT NULL DEFAULT 1,
  evidence_json TEXT NOT NULL,
  action_plan_json TEXT NOT NULL,
  measure_json TEXT NOT NULL,
  evidence_valid_until TEXT,
  deadline_at TEXT,
  decided_by TEXT,
  decided_at TEXT,
  decision_comment TEXT,
  params_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 任务、执行、验收、结果
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL REFERENCES decisions(id),
  module_id TEXT NOT NULL,
  title TEXT NOT NULL,
  action_id TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  status TEXT NOT NULL,            -- queued | running | blocked | submitted | verifying | verified | measuring | closed | failed | cancelled
  assignee_preset TEXT,
  capability_token_hash TEXT,
  params_json TEXT NOT NULL,
  acceptance_json TEXT NOT NULL,
  baseline_value REAL,
  target_value REAL,
  measure_metric TEXT,
  measure_at TEXT,
  measure_window_days INTEGER,
  attempt INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE task_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  session_id TEXT,
  trigger TEXT NOT NULL,           -- dispatch | retry | manual
  status TEXT NOT NULL,            -- running | completed | failed | cancelled
  model TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  input_json TEXT,
  output_json TEXT,
  error TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  kind TEXT NOT NULL,              -- file | url | draft | image | pr
  path TEXT,
  url TEXT,
  sha256 TEXT,
  meta_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE verifications (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  checks_json TEXT NOT NULL,
  verdict TEXT NOT NULL,           -- pass | fail | needs_human
  verified_by TEXT NOT NULL,       -- human | ceo-agent | rule
  comment TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE outcomes (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  metric_key TEXT NOT NULL,
  baseline_value REAL,
  target_value REAL,
  measured_value REAL,
  verdict TEXT NOT NULL,           -- improved | no_change | worse | unmeasured
  measured_at TEXT NOT NULL,
  note TEXT
);

-- 知识、审计、设置
CREATE TABLE knowledge_docs (
  id TEXT PRIMARY KEY,
  module_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  tags_json TEXT,
  links_json TEXT,                 -- decision/task/outcome ids
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE knowledge_fts USING fts5(
  title, body, tags, content='knowledge_docs', content_rowid='rowid'
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,             -- human | ceo-agent | content-agent | system
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_hash TEXT,
  after_hash TEXT,
  detail_json TEXT,
  prev_hash TEXT,
  hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

**审计链**：`audit_log.hash = sha256(prev_hash + canonical_json(event))`，追加写，不更新不删除。每天导出一次到 `audit/YYYY-MM-DD.jsonl`。

### 5.5 一条完整数据流（内容模块）

```text
① 导入抖音 CSV
   → snapshot(snap_001, sha256, 1,240 行)
   → metrics(播放/完播率/互动率，按视频、按天)

② 规则巡检
   → 完播率 7 日均值 32%，比过去 4 个同星期均值低 18%
   → observation(high, evidence=[snap_001 + 计算式])

③ CEO 简报
   → 只基于 observation 和最近 14 天数据
   → 判断：60 秒以上选题完播率下降，30 秒内稳定
   → 方案 A：改开头 3 秒；B：缩短到 45 秒；C：换封面（证据不足，不推荐）
   → 推荐 A，置信度 0.62，7 天后看 3 秒留存

④ 老板拍板
   → 同意 A，批注“不要夸张标题”

⑤ CEO 派活
   → task(rewrite-hook, R1, 产出 3 个钩子版本)
   → capability token 绑定参数

⑥ 内容 Agent 执行
   → 读任务简报 + 历史高完播开头
   → 产出 3 个版本 + 每个版本的依据
   → submit_task_result

⑦ CEO 验收
   → 规则检查：3 个版本、每个 ≤ 80 字、无禁用词、含具体冲突
   → 人工选择版本
   → 发布仍由人完成（R3）

⑧ 回数据
   → measure_at = 发布后 72h
   → 拉新快照，比较 3 秒留存/完播率
   → outcome = improved / no_change / worse
   → 写入知识库：什么开头有效、什么选题无效
```

---

## 6. Agent 设计

### 6.1 Agent 不是进程，是“岗位 + 权限 + 技能 + 会话”

| 要素 | 实现 |
|---|---|
| 岗位 | `ModuleDescriptor.agent.preset` + 系统提示 |
| 权限 | 该 preset 可见的工具清单；高风险动作只给 `request_action` |
| 技能 | `SKILL.md` / 运行手册 / 示例 / 验收标准 |
| 会话 | DSH session；按需创建或恢复，不常驻 |
| 记忆 | 业务库 + 知识库；不依赖聊天历史 |
| 交付 | 结构化 `result.json` + artifacts，不是一段自由文本 |

### 6.2 七个角色

| 角色 | 使命 | 主要输入 | 主要输出 | 权限上限 | 节奏 |
|---|---|---|---|---|---|
| CEO | 汇总、解释、提议、验收建议 | 所有模块的 observation / task / outcome | 简报、decision 草案、验收意见 | R1（只能提议） | 每日 + 有变化时 |
| 电商 | 店铺经营与商品优化 | 订单、流量、毛利、库存 | 异常归因、Listing 草稿、图片方案 | R2（需审批） | 每日 |
| 内容 | 选题、脚本、发布复盘 | 平台数据、评论、素材 | 选题、脚本、标题、封面提示词 | R2（发布 R3） | 每日 |
| 开源 | Issue 分级与修复 | GitHub Issues/PR/CI | 分级、修复方案、PR 草稿 | R2（合并 R3） | 每 2 小时 |
| 投资 | 台账与风险汇报 | 持仓、行情、交易记录 | 汇总、风险提示、复盘 | R0（不交易） | 每日 |
| 知识库 | 沉淀与检索 | 决策、任务、结果、文档 | 结构化知识、日报 | R1 | 每晚 |
| 助理 | 论坛、职位、日程扫描 | RSS/API、日历 | 去重后的机会清单 | R0 | 每日 |

**MVP 只实现 CEO + 内容（或电商）两个角色。** 其余角色先有 descriptor，不启用。

### 6.3 CEO 的两种模式

**模式 A：巡检（确定性，不调用 LLM）**

每 15 分钟 / 每小时：

1. 检查每个数据源是否该同步、是否过期。
2. 计算指标、跑异常规则、去重。
3. 检查任务 SLA：running 超时、submitted 待验收、approved 未派活。
4. 检查待拍板是否过期。
5. 更新模块健康灯和“今日巡视轮次/出手次数”。
6. 只有出现新 observation、critical 异常、任务提交、数据转红时，才触发模式 B 或通知。

这就是截图里的“每小时巡视，今天 8 轮，出手 4 次”。**大部分轮次不应该调用大模型。**

**模式 B：简报（调用 LLM，但结构化）**

触发：每日固定时间、用户点击、critical 变化、周复盘。  
流程：

1. 控制面组装 `evidence_pack`：只含允许进入模型的数据，带 snapshot id、指标、对比、最近决策、未闭环任务。
2. 在 CEO 会话中发送简报任务；CEO 通过工具读取证据、调用 `propose_decision` 写入候选。
3. `propose_decision` 做服务端校验：schema、证据存在、数值一致、最多 3 条、去重、风险等级。
4. 校验失败 → 不展示模型原文，回退到确定性模板，并记录 `brief_validation_failed`。
5. 生成 `briefs` + `decisions(pending)`，UI 显示。

**为什么让 CEO 调工具，而不是解析自由文本**

- 工具参数有 schema，服务端能逐字段校验。
- 模型不能“顺手”写一个不存在的 snapshot id。
- 会话日志完整记录模型为什么这么建议，便于复盘。

### 6.4 模块 Agent 的执行契约

派活时给 Agent 一个 `task.json`：

```json
{
  "taskId": "task_...",
  "goal": "为‘海盐款’香薰写 3 个开头 3 秒钩子",
  "context": {
    "module": "content",
    "evidence": ["snap_...", "obs_..."],
    "brandVoice": "直接、具体、不夸张",
    "forbidden": ["最", "第一", "国家级", "编造亲身经历"]
  },
  "acceptance": [
    "恰好 3 个版本",
    "每个 ≤ 80 字",
    "每个包含具体冲突或悬念",
    "无禁用词",
    "每个版本附一句依据"
  ],
  "allowedActions": ["draft", "file_write"],
  "forbiddenActions": ["publish", "delete", "shell", "web_fetch"],
  "deadline": "2026-10-26T12:00:00+08:00"
}
```

Agent 必须返回：

```json
{
  "taskId": "task_...",
  "status": "submitted",
  "summary": "3 个钩子，分别走价格冲突、使用场景、反常识",
  "artifacts": [
    { "kind": "draft", "path": "tasks/task_.../hooks.md" }
  ],
  "selfCheck": [
    { "check": "恰好 3 个版本", "pass": true },
    { "check": "无禁用词", "pass": true }
  ],
  "openQuestions": []
}
```

控制面校验：artifact 存在、字段完整、验收项逐条有结果。缺项 → `submitted` 但 `verification=needs_human`，不允许直接 `verified`。

### 6.5 Agent 之间的通信

**不做自由聊天。** Agent 之间只通过任务记录通信：

- CEO → 模块 Agent：`task` + `task.json`。
- 模块 Agent → CEO：`result.json` + artifacts。
- 模块 Agent 需要另一个模块的数据：调用只读工具，不直接找另一个 Agent。
- 模块 Agent 需要人决策：创建 `observation` / `request_action`，不私聊老板。

这样可以避免：无限对话、责任不清、token 爆炸、无法审计。

### 6.6 子 Agent 的实现方式

- **MVP**：CEO 会话里由用户触发；任务执行用当前工作台会话或一个普通会话，人工看着跑。
- **Phase 2**：用 `ctx.subagents` 的 `startActivation()` 启动模块 Agent；child session 持久化，结果结构化返回。
- **Phase 3**：定时巡检 + 自动派活；仍然只对 R1 自动执行，R2/R3 必须审批。

> 关键：**先把“单会话 + 人工触发”跑通，再上子 Agent。** 不要第一天就做七 Agent 编排。

---

## 7. 工作流引擎

### 7.1 作业清单

| 作业 | 触发 | 做什么 | 失败怎么办 |
|---|---|---|---|
| `SweepJob` | 每 15 分钟 | 数据源到期检查、指标计算、异常规则、任务 SLA、健康灯 | 记录错误，指数退避，不阻断其他模块 |
| `SyncJob` | 数据源到期 / 手动 | 调用 adapter 拉数据，写 snapshot | 连续 3 次失败 → 红灯 + 待办 |
| `BriefJob` | 每日 08:20 / 手动 / critical | 组装证据包，CEO 生成简报和候选决策 | 校验失败 → 确定性模板；模型失败 → 保留数据、不生成建议 |
| `DispatchJob` | decision approved | 校验证据新鲜度、生成任务和能力令牌、启动执行 | 证据过期 → 回 pending；启动失败 → blocked |
| `ExecutionJob` | task queued | 启动 Agent 会话，注入 task.json，等待结果 | 超时 → failed；可重试 1 次，带失败上下文 |
| `VerifyJob` | task submitted | 规则检查 + 可选 CEO 复核 + 人工签收 | 不通过 → 返回修改，不自动关闭 |
| `MeasureJob` | measure_at 到期 | 拉新数据，计算 outcome，回灌知识库 | 无数据 → unmeasured + 数据缺口待办 |
| `KnowledgeJob` | 每晚 23:30 | 汇总当天决策、任务、结果，写知识文档和 FTS | 失败不影响主流程，次日补跑 |
| `AuditExportJob` | 每日 | 导出审计 JSONL，校验哈希链 | 失败告警 |

### 7.2 幂等与恢复

- 每个作业有 `job_key`（如 `sync:douyin-main:2026-10-25`），唯一索引防重复。
- 所有写操作使用事务；状态迁移使用 `WHERE status = 'expected'` 乐观锁。
- 进程重启后：
  - `running` 超过 2× 超时的任务 → `failed`，可重试。
  - `approved` 未派活 → 继续派活（重新校验证据）。
  - `submitted` 未验收 → 保持待验收。
- 不允许“重启后任务消失”或“重复上架两次”。

### 7.3 超时与熔断

| 对象 | 超时 | 熔断 |
|---|---|---|
| 数据源同步 | 5 分钟 | 连续 3 次失败 → 红灯，暂停自动同步 1 小时 |
| Agent 执行 | 30 分钟（可配） | 同一任务失败 2 次 → abandoned，通知人 |
| LLM 简报 | 3 分钟 | 失败 → 确定性模板，不阻塞看板 |
| 外部动作 | 2 分钟 | 失败 → 不自动重试（避免重复副作用），转人工 |

### 7.4 “CEO 出手”的定义

UI 上的“今天出手 N 次”不是模型调用次数，而是有业务后果的动作：

- 生成了一份新简报；
- 升级了一条 critical observation；
- 创建了一条待拍板 decision；
- 派发了一个任务；
- 完成了一次验收建议；
- 触发了一次数据缺口待办。

单纯的巡检轮次不算“出手”。

---

## 8. 界面设计

### 8.1 布局选择

采用 **业务整页 + 按需会话**：

- `customFrame: true`，`headerLayout: 'compact'`。
- 默认展示经营看板，不常驻聊天区。
- 右侧抽屉放宿主提供的 `conversation` 节点；用户点“问 CEO”或“让 Agent 执行”时打开。
- 不复制聊天界面；使用宿主原生会话。

原因：这个产品的主任务是“看数据、做决定”，不是“聊天”。常驻聊天会挤压看板，也会让用户误以为所有建议都在聊天里。

### 8.2 信息架构

```text
总览
├─ 今日判断（CEO 简报，最多 3 条）
├─ 待拍板（3）
├─ 运行中 / 待验收（5）
├─ 模块卡片（电商 / 内容 / 开源 / 投资 / 知识 / 助理）
├─ 数据健康（绿/黄/红）
└─ 最近活动（审计流）

决策
├─ 待拍板
├─ 需修改
├─ 已通过 / 已驳回
└─ 详情：证据、选项、建议、风险、测量计划、审批记录

任务
├─ 队列 / 执行中 / 待验收 / 测量中 / 已闭环
└─ 详情：时间线、Agent 会话、产物、验收清单、结果

模块
├─ 模块总览
├─ 子数据源卡片
├─ 指标趋势
├─ 异常与建议
└─ 运行手册（这个岗位怎么干活）

数据源
├─ 状态表（最近同步、下次同步、行数、质量分）
├─ 导入向导（CSV 映射 → 预览 → 提交）
├─ API 适配器（密钥引用、测试连接）
└─ 数据质量报告

知识
├─ 搜索（FTS）
├─ 按模块浏览
├─ 每日沉淀
└─ 决策 / 任务 / 结果的反向链接

AI 工作
├─ 运行记录（角色、触发、耗时、token、状态）
├─ 工具调用轨迹
├─ 失败与重试
└─ 打开对应 DSH 会话

设置
├─ 风险策略矩阵
├─ 调度时间
├─ 角色与模型
├─ 数据保留 / 导出 / 备份
├─ 全局暂停（kill switch）
└─ 审计日志
```

### 8.3 总览线框

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ 一人公司      ● 数据 6/7   ○ CEO 08:20   [生成今日简报] [暂停] [问 CEO]      │
├──────────┬───────────────────────────────────────────────────────────────────┤
│ 总览      │ 今日判断                                            依据 12 条 →   │
│ 决策 3    │ 内容：B站 60s+ 选题完播率连续 3 天下降 18%，30s 内稳定。          │
│ 任务 5    │ 建议：先改 3 条开头，保留封面；72h 后看 3 秒留存。  [拍板] [追问] │
│ 模块      │                                                                   │
│ 数据源    │ ┌─ 电商 ─────┐ ┌─ 内容 ─────┐ ┌─ 开源 ─────┐ ┌─ 投资 ─────┐    │
│ 知识      │ │ $309 本周  │ │ +1.46万    │ │ +47 stars  │ │ 2/2 模块   │    │
│ AI 工作   │ │ ● 绿 08:05 │ │ ● 黄 08:16 │ │ ● 绿 07:00 │ │ ● 绿 08:20 │    │
│ 设置      │ └────────────┘ └────────────┘ └────────────┘ └────────────┘    │
│           │                                                                   │
│           │ 待拍板 3    运行中 2    今日验收 4    数据异常 1                   │
│           │ ┌─────────────────────────────────────────────────────────────┐   │
│           │ │ [内容] 海盐款加购率下降 22%   风险 R1   2 小时前   [去拍板] │   │
│           │ │ [电商] 香薰新品标题 A/B      风险 R2   昨天      [去拍板] │   │
│           │ └─────────────────────────────────────────────────────────────┘   │
└──────────┴───────────────────────────────────────────────────────────────────┘
```

### 8.4 决策详情：一页决策备忘录

固定结构，避免模型长篇大论：

1. **发生了什么**：一句话 + 关键数字（含对比期、样本量）。
2. **证据**：可展开的表格 / 折线；每条带 snapshot id 和“查看原始行”。
3. **可能原因**：按证据等级排序，明确标注“疑似 / 较可能 / 已确认”。
4. **选项**：A/B/C，每个含预期效果、成本、风险、可逆性。
5. **建议**：推荐哪个，为什么，置信度多少。
6. **怎么验证**：指标、基线、目标、观察窗口。
7. **我要你拍什么**：同意 / 驳回 / 修改；R3 需要输入确认短语。
8. **审批记录**：谁、何时、看了哪个版本、参数哈希。

### 8.5 视觉规范

- 深色“任务控制台”，但不是赛博朋克：近黑背景、低饱和模块色、暖色只留给“人的决定”。
- 状态色只用于状态：绿=正常，黄=偏旧/待关注，红=阻断；不要用红色做普通强调。
- 数字用等宽字体；每个数字必须有单位、周期、对比基准。
- AI 生成内容统一标“AI 建议”，并有“依据”入口；人的决定用实心按钮，AI 建议用描边按钮。
- 不做没有数据支撑的装饰性图表；图必须能点回证据。
- 响应式按**业务容器宽度**，不是窗口宽度：4 列 → 2 列 → 1 列；长中文标题不竖排、不裁切。
- 键盘可达；状态不能只靠颜色，配图标 + 文字。

### 8.6 首次使用

1. 打开工作台，显示“先接入一个数据源”，不自动创建会话。
2. 提供示例 CSV（内容或电商），一键导入，立刻看到一条闭环演示。
3. 演示数据明确标“示例”，可一键清除。
4. 没有数据时，不显示“今日建议”，只显示“需要什么数据、为什么”。
5. 第一个真实数据源导入成功后，才出现“生成第一份简报”。

---

## 9. API、工具与包结构

### 9.1 本机 API

统一前缀 `/api/ai-company/`，只注册在 `ctx.webServer`，仅回环。

| 方法 | 路径 | 用途 | 保护 |
|---|---|---|---|
| GET | `/overview` | 总览数据 | 同源 + 自定义头 |
| GET | `/modules` | 模块列表与健康 | 同上 |
| GET | `/modules/:id` | 模块详情 | 同上 |
| GET | `/decisions?status=` | 决策列表 | 同上 |
| GET | `/decisions/:id` | 决策详情 + 证据 | 同上 |
| POST | `/decisions/:id/approve` | 人工拍板 | UI nonce + 参数哈希 + 同源 |
| POST | `/decisions/:id/reject` | 驳回 | 同上 |
| POST | `/decisions/:id/request-changes` | 要求修改 | 同上 |
| GET | `/tasks` | 任务列表 | 同上 |
| GET | `/tasks/:id` | 任务详情 + 运行 + 产物 | 同上 |
| POST | `/tasks/:id/retry` | 重试 | 同上 |
| POST | `/tasks/:id/verify` | 人工验收 | 同上 |
| POST | `/tasks/:id/close` | 关闭（需 outcome 或原因） | 同上 |
| GET | `/sources` | 数据源状态 | 同上 |
| POST | `/sources/:id/import` | CSV 导入 | 大小限制 + 映射校验 |
| POST | `/sources/:id/sync` | 手动同步 | 速率限制 |
| POST | `/sources/:id/test` | 测试连接 | 不返回密钥 |
| GET | `/knowledge/search?q=` | 知识检索 | 同上 |
| GET | `/audit?limit=` | 审计 | 只读 |
| GET | `/export` | 导出 JSON / SQLite 备份 | 人工触发 |
| POST | `/pause` | 全局暂停 | 人工触发 |
| GET | `/health` | 插件自检 | 无敏感信息 |

**统一防护**

- `Cache-Control: no-store`。
- 拒绝非回环 `remoteAddress`。
- 无 CORS 头；POST 要求 `Content-Type: application/json` + `X-AI-Company-Request: 1`。
- 审批额外要求 `X-Approval-Nonce`，由 `GET /decisions/:id/approval-challenge` 签发，2 分钟有效，绑定 decision + params hash。
- JSON body 上限 1 MB；CSV 上限 20 MB / 100k 行。
- 所有 SQL 使用参数绑定；所有文件路径由服务端生成，不接受用户路径。
- 错误信息不回显堆栈、密钥、绝对路径。

### 9.2 给 Agent 的工具

工具按角色作用域注册，不是全局可用。

| 工具 | 谁能用 | 作用 | 关键校验 |
|---|---|---|---|
| `company_overview` | CEO | 读总览 | 只读 |
| `company_module_detail` | CEO / 模块 Agent | 读模块指标和 observation | 只读，按模块作用域 |
| `company_decisions_list` | CEO | 读待拍板 / 最近决策 | 只读 |
| `company_task_get` | CEO / 执行 Agent | 读任务 | 只读，按任务作用域 |
| `company_knowledge_search` | 所有角色 | 检索知识 | 只读，返回片段 + 链接 |
| `company_propose_decision` | CEO | 写入候选决策 | schema + 证据存在 + 最多 3 条 + 去重 |
| `company_submit_task_result` | 执行 Agent | 提交结果 | 任务归属 + 验收字段 + artifact 存在 |
| `company_request_action` | 模块 Agent | 请求外部动作 | 只创建待审批，不执行 |
| `company_record_observation` | 模块 Agent | 记录发现 | 证据必填 |

**没有** `company_approve_decision`、`company_execute_action`、`company_delete_data` 这些工具。

### 9.3 包结构

```text
dsh-ai-native-company/
├─ package.json
├─ cordis.patch.yml
├─ README.md
├─ LICENSE
├─ dsh/
│  ├─ index.js                 # Host 入口：Config、路由、定时器、服务装配
│  ├─ db.js                    # SQLite 打开、迁移、事务
│  ├─ schema.sql
│  ├─ policy.js                # 风险矩阵、能力令牌、审批校验
│  ├─ engine/
│  │  ├─ sweep.js
│  │  ├─ brief.js
│  │  ├─ dispatch.js
│  │  ├─ execute.js
│  │  ├─ verify.js
│  │  ├─ measure.js
│  │  └─ knowledge.js
│  ├─ adapters/
│  │  ├─ csv.js
│  │  ├─ manual.js
│  │  └─ github.js             # Phase 2
│  ├─ modules/
│  │  ├─ content.js
│  │  ├─ ecommerce.js
│  │  ├─ opensource.js
│  │  ├─ invest.js
│  │  ├─ knowledge.js
│  │  └─ assistant.js
│  ├─ tools.js
│  └─ prompts/
│     ├─ ceo-brief.md
│     ├─ module-task.md
│     └─ verify.md
├─ src/
│  └─ client/                  # React 源码
│     ├─ index.jsx
│     ├─ shell.jsx
│     ├─ pages/
│     ├─ components/
│     └─ styles.css
├─ lib/
│  └─ client.js                # esbuild 单文件产物
├─ locale/
│  └─ zh-CN.json
└─ scripts/
   ├─ build-client.mjs
   └─ check-workbench-package.mjs
```

### 9.4 `package.json` 关键字段

```json
{
  "name": "dsh-ai-native-company",
  "version": "0.1.0",
  "type": "module",
  "main": "./dsh/index.js",
  "exports": {
    ".": "./dsh/index.js",
    "./client": "./lib/client.js",
    "./package.json": "./package.json",
    "./cordis.patch.yml": "./cordis.patch.yml"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": ["dsh-desktop-workbenches"]
    }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": ">=4.0.2 <5.0.0-0",
    "@deepseek-ai/schemastery": ">=3.18.0 <4.0.0-0"
  }
}
```

> `dsh.client.inject` 必须包含 `dsh-desktop-workbenches`，否则工作台服务可能还没加载。  
> `peerDependencies` 要显式包含预发布分支，避免 DSH Desktop 的预发布版本被 `ERESOLVE` 排除。

### 9.5 `cordis.patch.yml`

```yaml
- insert:
    - id: ai-native-company
      name: dsh-ai-native-company
      config:
        root: !!js dshHomePath('ai-native-company')
```

只插一行。不要在 patch 里写模块、表、工作流定义——那些是插件内部配置，不是 Cordis 插件树。

### 9.6 服务端入口

```js
import Schema from '@deepseek-ai/schemastery'

export const name = 'dsh-ai-native-company'
export const inject = ['webServer']

export const Config = Schema.object({
  root: Schema.string().required(),
  timezone: Schema.string().default('Asia/Shanghai'),
  sweepIntervalMinutes: Schema.number().default(15),
  briefTime: Schema.string().default('08:20'),
  maxPendingDecisions: Schema.number().default(3),
  killSwitch: Schema.boolean().default(false),
})

export function apply(ctx, config) {
  // 1. 打开数据库 / 运行迁移
  // 2. 注册 API 路由（仅回环）
  // 3. 注册 Agent 工具（按角色作用域）
  // 4. 注册定时器（ctx.effect 返回 disposer）
  // 5. 注册健康检查 / 审计导出
}
```

### 9.7 客户端入口

```js
window.__ModuleLoader__.load({
  id: 'dsh-ai-native-company',
  factory: (require) => {
    const React = require('react')

    function BusinessPanel({ service, entry, active, conversation }) {
      // 总览 / 决策 / 任务 / 模块 / 数据源 / 知识 / AI 工作 / 设置
      // conversation 只在抽屉打开时渲染
      return React.createElement(App, { service, entry, active, conversation })
    }

    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.dshPlugin = 'dsh-ai-native-company'
        style.textContent = css
        document.head.appendChild(style)
        return () => style.remove()
      })

      ctx.effect(() => ctx.desktopWorkbenches.register({
        title: '一人公司',
        repository: 'https://github.com/<owner>/<repo>',
        description: '用数据经营、用 AI 放大、由你拍板的经营工作台。',
        panelTitle: '经营看板',
        customFrame: true,
        headerLayout: 'compact',
      }, BusinessPanel))
    }

    return { apply, inject: ['desktopWorkbenches', 'sessions'] }
  },
})
```

> `repository` 必须是真实的 GitHub 仓库地址（本地使用可以是私有仓库），不能填占位符；宿主用它解析工作台身份。没有仓库就先建一个，再安装。

### 9.8 与当前会话交互

工作台不自己实现聊天。需要 Agent 执行时：

- 使用宿主传入的 `conversation` 节点渲染原生会话。
- 需要预填任务简报时，用真实工作台示例里的方式：

```js
const actx = ctx.sessions.scope(sessionId)
const input = actx?.get?.('conversation')?.input.for(actx)
input?.setDraft(prompt)   // 只填草稿，由用户发送
```

- 不自动发送、不隐藏发送；所有给 Agent 的输入用户可见。
- 自动任务（Phase 3）走独立的任务会话，并在 UI 里明确标注“自动执行”。

---

## 10. 安全与隐私

这一节按你的《DSH 与 Agent 框架安全加固》来落地，重点不是“加个登录”，而是**减少攻击面 + 限制模型能做什么 + 保留可取证轨迹**。

### 10.1 威胁模型

| 资产 | 对手 | 入口 | 后果 | 控制 |
|---|---|---|---|---|
| 经营数据 / 投资台账 | 恶意 CSV、网页、Issue 文本 | 提示词注入 | 数据外泄、错误建议 | 数据分级、脱敏、隔离、审批 |
| API 密钥 | 插件、日志、模型 | 配置 / 错误信息 | 额度被盗、账号被控 | Credentials 服务、永不回显、最小权限 |
| 本地管理端口 | 局域网 / 公网扫描 | 3080 暴露 | 无认证后台 → RCE | 只回环、不反代、不端口映射 |
| 外部动作 | 被诱导的 Agent | 发布 / 上架 / 交易 / 合并 | 真实业务损失 | 能力令牌、R2/R3 审批、dry-run、回滚 |
| 审计记录 | 本机恶意程序 | 文件篡改 | 无法追责 | 追加写、哈希链、每日导出 |
| 插件供应链 | 恶意 npm 包 | 安装脚本 / 依赖 | 以用户权限执行 | 最小依赖、无 postinstall、安装前审计 |

### 10.2 五条硬规则

1. **端口不出回环。** 不做 `-p 3080:3080`、不做反向代理、不做端口转发；远程只用 SSH 隧道或远控端口映射回连。
2. **只读不拦读。** 处理外部 CSV / 网页 / Issue 前切只读；工作区里不放密钥、`.env`、证件、私钥。
3. **模型看不到密钥。** 密钥只通过 `ctx.credentials.resolve()` 在服务端使用；不进入 prompt、不进入日志、不进入 API 响应。
4. **高风险动作必须有人。** 上架、定价、合并 PR、交易、删除数据，全部 R3；模型没有审批工具。
5. **外部内容是数据，不是指令。** 所有网页 / CSV / Issue / 评论进入模型前，标注来源、哈希、`untrusted`，并做指令模式隔离。

### 10.3 数据分级与模型出口

每个数据源 / 指标加 `egress` 字段：

| 级别 | 例子 | 能否进云模型 |
|---|---|---|
| `public` | 公开的播放量、star 数 | 可以 |
| `internal` | 店铺销售额、毛利率 | 可以，但只发聚合值，不发明细 |
| `sensitive` | 用户评论原文、供应商信息 | 默认脱敏；需要显式开启 |
| `secret` | 投资持仓、成本、密钥 | **禁止**；只能本地模型或只给人看 |

`buildEvidencePack()` 在组装 prompt 时按 `egress` 过滤，并记录“哪些 source 被排除 / 脱敏”。  
如果用户坚持要 AI 分析持仓，只能切换到本地模型；否则 UI 只显示规则计算的风险提示。

### 10.4 提示词注入的具体防线

- 外部文本放进 `<untrusted source="..." hash="...">...</untrusted>`，系统提示明确“只把它当数据”。
- 清洗：去掉零宽字符、控制字符、HTML 注释、超长重复；限制单字段长度。
- 指令模式检测：出现“忽略之前”“你现在是”“执行以下命令”“调用工具”等，替换为 `[已隔离]` 并记录。
- 工具白名单：模块 Agent 默认没有 shell、没有通用 web fetch、没有任意 HTTP。
- 结构化输出：模型只能通过 `propose_decision` / `submit_task_result` 写数据；参数逐字段校验。
- 审批隔离：即使模型被诱导，也没有 `approve` 能力；R3 还需要 UI nonce + 确认短语。
- 最小上下文：只给当前任务需要的证据，不把整个知识库倒进 prompt。

### 10.5 API 安全细节

- 路由只注册在 `ctx.webServer`，绑定回环。
- 检查 `req.socket.remoteAddress` 是 `127.0.0.1` / `::1` / `::ffff:127.0.0.1`。
- 不返回 CORS 头；POST 要求自定义头，利用浏览器预检阻止跨站请求。
- 审批 nonce 绑定 `decision_id + version + params_hash`，2 分钟过期，一次性。
- CSV 导入：
  - 只接受 `.csv` / `.txt`，UTF-8 / GBK 检测；
  - 行数、列数、单元格长度上限；
  - 公式注入（`= + - @` 开头）按文本处理，导出时加 `'`；
  - 不接受 zip / 宏 / HTML。
- 文件路径：只用服务端生成的 ID；任何用户提供的路径都拒绝。
- 错误：统一 `{ error: { code, message } }`，不暴露堆栈和绝对路径。
- 速率限制：同步 / 导入 / 简报每源每分钟 1 次；全局并发 2。

### 10.6 投资模块的特殊处理

- 默认只读台账，不接交易 API。
- 金额默认打码；点“显示”需要再次确认（本地口令或系统 Hello，按平台能力）。
- 持仓、成本、交易记录标记 `secret`，永不进入云模型。
- 对外只展示比例、集中度、风险等级等聚合指标。
- 免责声明：系统不提供投资建议；所有买卖由人决定。
- 如果未来接券商 API：先只读；交易必须 R3 + 双人确认（或双设备确认）+ 冷静期；默认关闭。

### 10.7 审计与取证

- `audit_log` 追加写，哈希链；每日导出 JSONL。
- 记录：谁（human / agent / system）、什么动作、哪个实体、前后哈希、参数哈希、时间。
- Agent 运行另存 `task_runs`：模型、token、输入摘要、输出、错误、会话 id。
- 出问题时的顺序：
  1. 全局暂停（kill switch）。
  2. 导出审计和 `task_runs`。
  3. 检查 DSH 轨迹日志：`cordis define` / `cordis run` / `sub process`。
  4. 吊销并轮换密钥。
  5. 回滚外部动作（如果可回滚）。
  6. 复盘：哪些外部内容进入了上下文，哪条规则没拦住。

### 10.8 供应链

- 依赖尽量少：React 用宿主基线，服务端只用 `@deepseek-ai/schemastery` + Node 内置模块；SQLite 驱动按 spike 结果选。
- 不写 `postinstall`；不在安装时下载二进制。
- 安装前按四步审计：发布者、`npm pack` 解包、搜 6 个高危词、`npm ls --all`。
- 本地开发优先 `link:`，发布用 npm 预构建或 tarball；git 安装要 pin commit。

---

## 11. 实施路径

### Phase 0：技术 spike + 骨架（2–3 天）

目标：证明“能装、能开、能写库、能调会话”。

- [ ] 建包、`package.json`、`cordis.patch.yml`、Host 入口、`/health` 路由。
- [ ] 客户端 `register()` + 空看板，确认左侧工作台入口出现。
- [ ] 验证 SQLite 驱动在 Desktop Harness 进程可用；跑通建表和一次写入。
- [ ] 验证 `ctx.credentials` 读写（只返回 describe，不回显值）。
- [ ] 验证 `conversation` 节点和 `setDraft()`。
- [ ] `pnpm pack` + 本机安装 + 重启后加载。

**通过标准**：重启 Desktop 后，工作台能从左侧打开，`/health` 返回版本，数据库文件在 `root` 下，空看板不报错。

### Phase 1：单模块闭环（5–7 天）

目标：一个模块从 CSV 到“回数据”完整跑通。默认选**内容**（你已有内容工作台和数据；电商 API 太重）。

- [ ] 内容模块 descriptor + CSV 导入向导 + 字段映射 + 预览。
- [ ] 指标计算 + 数据质量分 + 新鲜度灯。
- [ ] 3 条异常规则（完播率下降、互动率下降、播放量异常）。
- [ ] 证据包 + CEO 简报（工具调用 + 服务端校验 + 确定性回退）。
- [ ] 决策收件箱 + 审批 nonce + 驳回 / 要求修改。
- [ ] 任务生成 + 人工执行清单 + 验收 + `measure_at`。
- [ ] 总览、决策详情、数据源三个页面。
- [ ] 审计日志 + 重启恢复。

**通过标准**：见第 12 节验收清单 1–10。  
**明确不做**：自动发布、自动改价、自动提 PR、真实平台 API。

### Phase 2：Agent 执行 + 第二模块（7–10 天）

- [ ] 内容 Agent preset：任务简报、产物、结构化结果、验收自检。
- [ ] 子 Agent 派活（`ctx.subagents`）或普通任务会话；超时 / 重试 / 取消。
- [ ] 能力令牌 + `request_action` + dry-run + 人工审批。
- [ ] 第二个模块：开源（GitHub API 只读 + Issue 分级）或电商（CSV + Listing 草稿）。
- [ ] 知识库夜间沉淀 + FTS 搜索 + 决策/任务反向链接。
- [ ] AI 工作页：运行记录、工具轨迹、失败重试、打开会话。
- [ ] 全局暂停 / 熔断 / 备份导出。

**通过标准**：Agent 能完成一个 R1 任务并被人验收；R2 动作能走到“待审批”但不会自动执行；杀掉进程后任务状态可恢复。

### Phase 3：自动化与扩展（持续）

- [ ] 真实 API 适配器（先只读）：抖音开放平台 / B站 / GitHub / Shopify。
- [ ] 定时 CEO 简报（DSH schedule 或插件定时器）。
- [ ] 移动端只读通知（走现有远控/隧道，不暴露 3080）。
- [ ] 影子模式：Agent 先提议，人做决定，系统比较差异；两周后再谈自动执行。
- [ ] 自动执行分级：只对 R1 开放；R2 保持审批；R3 永不自动。
- [ ] 向量检索（如果 FTS 不够用）；本地 embedding 优先。
- [ ] 多公司 / 多品牌隔离（如果真需要）。

### 11.1 建议的第一天任务清单

1. 建 GitHub 私有仓库（工作台身份需要真实 repository URL）。
2. 跑 `scaffold-plugin.mjs` 生成骨架，替换成本设计的结构。
3. 写 `package.json` / `cordis.patch.yml` / `/health`。
4. 写客户端空壳 + `register()`。
5. `pnpm pack` → 本机安装 → 重启 → 确认入口。
6. 再写数据库和第一个页面。

> 不要在“能不能加载”验证之前写业务逻辑。工作台插件最常见的坑是包格式、客户端入口、`dsh.client.inject` 和 repository 身份，不是 React。

---

## 12. 验收清单

### 12.1 闭环

- [ ] 全新安装：空看板 + “接入第一个数据源”，不自动创建会话。
- [ ] 导入示例 CSV：字段映射、预览、提交；重复导入同一文件不产生重复快照。
- [ ] 指标计算正确；每个数字能点回原始行和计算式。
- [ ] 注入 20% 下降：生成 observation；简报引用它；没有 L3/L4 证据时不写“已确认原因”。
- [ ] 数据过期：模块变黄/红；不能生成新 decision；已有 decision 派活前被拦住。
- [ ] 审批：模型工具表里没有 approve；UI 审批需要 nonce；参数哈希不一致时拒绝。
- [ ] 派活：生成 task + 能力令牌；参数不可改；重复点击不重复派活。
- [ ] 执行：Agent 提交结果；缺 artifact 时验收不通过；重试带失败上下文。
- [ ] 验收：执行 Agent 不能自己验收；人工签收记录 actor/time/params。
- [ ] 回数据：到点生成 outcome；无数据时是 `unmeasured`，不是“成功”。

### 12.2 恢复与安全

- [ ] 杀掉进程重启：数据、决策、任务、审计都在；running 任务安全失败或恢复；无重复外部动作。
- [ ] 跨站 POST 被拒绝；非回环请求被拒绝；路径穿越被拒绝。
- [ ] CSV 公式注入被当作文本；超长字段被截断；超大文件被拒绝。
- [ ] API 响应、日志、prompt 里都没有密钥；`describe` 只返回是否配置。
- [ ] 投资字段在云模型 prompt 中被排除；导出日志能看到“已排除”。
- [ ] 审计哈希链校验通过；手工改一行会被发现。
- [ ] 全局暂停后，定时器和派活都停；恢复后不补跑高风险动作。

### 12.3 UI

- [ ] 侧栏展开/收起、窄窗口、长中文标题：不竖排、不裁切、不横向溢出。
- [ ] 业务面板不遮挡工作台切换、市场、设置入口。
- [ ] 键盘可完成：打开决策、查看证据、审批、取消。
- [ ] 空状态、加载、错误、无权限、数据过期都有明确文案。
- [ ] `conversation` 抽屉打开/关闭正常；不复制聊天界面；不自动发送。

### 12.4 包

- [ ] `pnpm pack` 产物包含 `package.json`、`dsh/index.js`、`lib/client.js`、`cordis.patch.yml`、`README`、`LICENSE`。
- [ ] 安装后 `dsh --profile desktop --dump-config` 能看到本包层。
- [ ] 市场/已安装列表能看到条目；左侧能切换；重启后仍在。
- [ ] 卸载不删除 `root` 下的用户数据；重装能恢复。

---

## 13. 需要你确认的三个决策

### 决策 1：第一个模块做内容还是电商？

**我的建议：内容。** 理由：

- 你已经有内容工作台和真实内容业务，数据容易手动回填。
- 抖音/B站数据即使没有 API，也能用 CSV/手动录入跑通闭环。
- 电商的 Amazon SP-API 门槛高（LWA、SigV4、审核、限流），容易把 MVP 拖死。
- 内容的“选题 → 发布 → 72h 数据 → 复盘”闭环非常清晰，适合验证状态机。

如果你坚持电商，核心状态机不变，只换 descriptor 和导入模板；但第一阶段会多花 1–2 周在 API/数据格式上。

### 决策 2：工作台仓库身份用什么？

`desktopWorkbenches.register()` 需要真实的 GitHub `repository` URL。请确认：

- 用哪个仓库？（可以是私有仓库，本地使用不需要公开代码。）
- 包名是否用 `dsh-ai-native-company`？显示名是否用“一人公司”？

没有真实仓库，工作台可能无法被宿主识别；不能填占位 URL。

### 决策 3：敏感数据（投资）是否允许进入云模型？

**我的建议：默认不允许。** 投资模块只做本地规则计算和脱敏汇总；如果以后要 AI 分析持仓，单独切本地模型。这样最稳，也符合你安全文档里的“数据离开本机后只剩对方的承诺”。

---

## 14. 现有 `dsh-ai-native-solo` 原型评估

结论：**保留概念，重写实现。** 它是一个可读的设计草稿，但不是可运行的 DSH 插件。

| 问题 | 位置 | 后果 |
|---|---|---|
| 包没有 `"type": "module"`，却用 `require()` 和 `module.exports` | `package.json` / `src/index.js` | DSH 插件是 ESM；加载会失败或行为不一致 |
| `dsh.bundle.patch` 写成数组，不是字符串 | `package.json` | 不符合当前 bundle 清单 |
| 没有 `dsh.client` / 客户端入口 | `package.json` | 不会出现在工作台，只有服务端 |
| `ctx.router` 不存在 | `src/index.js` | API 路由不会注册 |
| `Service` / `Inject` 用法不对，`static inject` 返回对象 | `src/modules/ceo-agent.js` | 服务加载/注入不符合 Cordis 语义 |
| 所有状态在内存数组 | 各 service | 重启全丢，无法审计 |
| patch 里有模块/表/工作流条目，但代码不读 | `cordis.patch.yml` | 死配置，误导维护 |
| 工具定义用裸对象 + `handler`，不是 `defineTool` | `ceo-agent.js` | 参数校验和输出渲染不成立 |
| 没有数据源、没有 UI、没有审批强制、没有测试 | 全局 | 无法验证闭环 |

**可以保留的**：

- 模块名称和职责划分；
- 九步闭环的术语；
- README 里的产品叙述；
- “老板只拍板”的产品原则。

**建议**：把旧目录归档为 `archive/dsh-ai-native-solo-v0`，新项目按本设计从零搭。不要在原骨架上补，补的成本高于重写。

---

## 15. 主要风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 数据源拿不到 / 格式不稳定 | 整个系统空转 | CSV/手动先跑；adapter 接口隔离；数据质量分 |
| 模型建议看似合理但无因果 | 误导决策 | 证据等级、反事实提示、A/B 测量、禁止“已确认” |
| 建议太多，老板不看 | 产品失败 | 每天最多 3 条；按风险和时效排序；一键驳回 |
| Agent 执行不可靠 | 验收成本高 | 结构化结果、验收清单、重试 1 次、人工签收 |
| 权限过大 / 注入 | 真实业务损失 | 无 approve 工具、能力令牌、R2/R3 审批、无 shell |
| 敏感数据进云 | 隐私/合规事故 | egress 分级、脱敏、默认禁止投资数据 |
| 工作台包格式/身份问题 | 装不上 | Phase 0 先验证；真实 repository；按规范打包 |
| 范围膨胀到 6 个模块 | 永远上不了线 | 一个模块闭环后再加；模块 descriptor 复用 |

---

## 16. 一页总结

- **做什么**：DSH Desktop 里的“一人公司”经营工作台。看数据、看判断、拍板、派活、验收、回数据。
- **不做什么**：不造第二套后端，不做七个常驻 Agent，不做无证据的 AI 建议，不做自动交易/自动上架。
- **核心机制**：不可变快照 + 证据链 + 确定性状态机 + 人工审批 + 能力令牌 + 回数据测量。
- **技术栈**：DSH Host 插件 + React 工作台 + SQLite + FTS5；CSV 先行，API 后置。
- **第一步**：Phase 0 技术 spike，证明能装、能开、能写库、能调会话；然后做一个模块的完整闭环。
- **成功标准**：老板每天 3 分钟能处理完待拍板；每个决定 7 天后有结果；系统重启不丢状态；模型没有审批权。

---

## 附录 A：CEO 简报提示词骨架

```text
你是这家一人公司的 CEO Agent。你的工作不是写漂亮话，是帮老板做决定。

规则：
1. 只能使用 <evidence> 中提供的数据。没有数据，就说“无法判断”，并指出缺什么。
2. 每个数字必须带：指标名、周期、对比基准、样本量、snapshot id。
3. 归因必须标注等级：L1 相关 / L2 时序 / L3 分层 / L4 实验。
   没有 L3/L4，不要写“因为”“导致”“已确认”。
4. 最多提出 3 条需要老板拍板的决策。按“影响 × 紧急度”排序。
5. 每条决策必须包含：发生了什么、证据、2–3 个选项、推荐、风险、置信度、怎么验证。
6. 不要建议上架、定价、交易、合并 PR 这类动作；这些必须由人发起。
7. 不要重复最近 14 天已被驳回的建议，除非有新证据。
8. 如果数据过期或质量分低于阈值，只输出“数据缺口”，不要给建议。

输出必须通过 propose_decision 工具提交，不要在正文里写自由格式的决策。
```

## 附录 B：模块任务提示词骨架

```text
你是 {module} 模块的执行 Agent。你只负责这一个任务，不负责公司级决策。

任务：{goal}
证据：{evidence}
验收标准：{acceptance}
禁止：{forbidden}

要求：
1. 先检查证据是否足够；不够就返回 blocked，并说明缺什么。
2. 产物写到任务目录，文件名可预测。
3. 每个验收项在 selfCheck 里给出 pass/fail 和证据。
4. 不执行任何外部动作；需要外部动作时调用 request_action。
5. 不编造数据、不编造用户经历、不使用禁用词。
```

## 附录 C：内容模块 CSV 最小字段

```csv
date,platform,account,video_id,title,published_at,views,completion_rate,likes,comments,shares,saves,followers_gained
2026-10-20,douyin,main,v123,海盐香薰怎么选,2026-10-20T19:00:00+08:00,48210,0.31,1203,88,45,210,36
```

映射后至少需要：`date`、`platform`、`account`、`video_id`、`views`、`completion_rate`。  
缺失字段不阻断导入，但会降低质量分，并在模块页显示“缺什么”。

## 附录 D：参考资料

- DSH Desktop 工作台开发规范：`dsh-desktop/docs/workbench-standard.zh.md`
- DSH 工作台市场与身份：`dsh-desktop/docs/workbenches.md`
- DSH 插件开发技能：`dsh-plugin-dev`（Cordis 语义、bundle/profile、安装）
- DSH 安全加固：`DSH与Agent框架安全加固-SKILL.md`
- 你的原始整理：`AI Native一人公司系统_核心工作原理.md`

---

*设计稿结束。下一步：确认第 13 节三个决策，然后进入 Phase 0 脚手架。*
