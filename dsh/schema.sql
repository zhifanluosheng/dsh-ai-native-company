-- Agent New Media Studio · schema v1
--
-- 设计约束：
-- 1. 快照不可变：snapshots 只追加，不更新 metrics 的历史含义。
-- 2. 决策先于执行：没有 approved 的 decision 不允许出现 task（应用层 + 触发器双保险）。
-- 3. 每个状态迁移与审计事件同事务写入（应用层保证）。
-- 4. FTS5 只做关键词检索，不引入向量库。

CREATE TABLE IF NOT EXISTS modules (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  phase         TEXT NOT NULL DEFAULT 'planned',   -- active | planned
  config_json   TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id                TEXT PRIMARY KEY,
  module_id         TEXT NOT NULL REFERENCES modules(id),
  name              TEXT NOT NULL,
  kind              TEXT NOT NULL,                  -- csv | manual | api
  secret_ref        TEXT,                           -- 引用，不存密钥本体
  cadence_hours     INTEGER NOT NULL DEFAULT 24,
  warn_after_hours  INTEGER NOT NULL DEFAULT 30,
  block_after_hours INTEGER NOT NULL DEFAULT 72,
  last_run_at       TEXT,
  last_success_at   TEXT,
  last_error        TEXT,
  status            TEXT NOT NULL DEFAULT 'unknown', -- green | yellow | red | unknown
  config_json       TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_sources_module ON sources(module_id);

-- 不可变快照：原始文件哈希唯一，重复导入直接复用同一条记录。
CREATE TABLE IF NOT EXISTS snapshots (
  id            TEXT PRIMARY KEY,
  source_id     TEXT NOT NULL REFERENCES sources(id),
  captured_at   TEXT NOT NULL,
  period_start  TEXT,
  period_end    TEXT,
  raw_path      TEXT NOT NULL,
  sha256        TEXT NOT NULL,
  row_count     INTEGER NOT NULL DEFAULT 0,
  quality_score REAL,
  quality_json  TEXT NOT NULL DEFAULT '{}',
  UNIQUE(source_id, sha256)
);

CREATE TABLE IF NOT EXISTS metrics (
  id              TEXT PRIMARY KEY,
  snapshot_id     TEXT NOT NULL REFERENCES snapshots(id),
  module_id       TEXT NOT NULL,
  metric_key      TEXT NOT NULL,
  value           REAL NOT NULL,
  unit            TEXT,
  dimensions_json TEXT NOT NULL DEFAULT '{}',
  period_start    TEXT,
  period_end      TEXT
);
CREATE INDEX IF NOT EXISTS idx_metrics_lookup ON metrics(module_id, metric_key, period_end);

CREATE TABLE IF NOT EXISTS observations (
  id           TEXT PRIMARY KEY,
  module_id    TEXT NOT NULL,
  kind         TEXT NOT NULL,              -- anomaly | trend | opportunity | data_gap | quality
  severity     TEXT NOT NULL,              -- low | medium | high | critical
  title        TEXT NOT NULL,
  detail       TEXT NOT NULL DEFAULT '',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  fingerprint  TEXT NOT NULL,
  confidence   REAL,
  status       TEXT NOT NULL DEFAULT 'open', -- open | promoted | dismissed | expired
  detected_at  TEXT NOT NULL,
  UNIQUE(module_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS briefs (
  id            TEXT PRIMARY KEY,
  brief_date    TEXT NOT NULL,
  version       INTEGER NOT NULL,
  summary       TEXT NOT NULL DEFAULT '',
  body_json     TEXT NOT NULL DEFAULT '{}',
  evidence_hash TEXT NOT NULL DEFAULT '',
  model         TEXT,
  prompt_hash   TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE(brief_date, version)
);

CREATE TABLE IF NOT EXISTS decisions (
  id               TEXT PRIMARY KEY,
  module_id        TEXT NOT NULL,
  brief_id         TEXT REFERENCES briefs(id),
  title            TEXT NOT NULL,
  diagnosis        TEXT NOT NULL DEFAULT '',
  options_json     TEXT NOT NULL DEFAULT '[]',
  recommendation   TEXT,
  risk_level       TEXT NOT NULL DEFAULT 'R1',  -- R1 | R2 | R3
  status           TEXT NOT NULL DEFAULT 'draft',
  version          INTEGER NOT NULL DEFAULT 1,
  evidence_json    TEXT NOT NULL DEFAULT '[]',
  action_plan_json TEXT NOT NULL DEFAULT '{}',
  measure_json     TEXT NOT NULL DEFAULT '{}',
  evidence_valid_until TEXT,
  deadline_at      TEXT,
  decided_by       TEXT,
  decided_at       TEXT,
  decision_comment TEXT,
  params_hash      TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status, created_at);

CREATE TABLE IF NOT EXISTS tasks (
  id                   TEXT PRIMARY KEY,
  decision_id          TEXT NOT NULL REFERENCES decisions(id),
  module_id            TEXT NOT NULL,
  title                TEXT NOT NULL,
  action_id            TEXT NOT NULL,
  risk_level           TEXT NOT NULL DEFAULT 'R1',
  status               TEXT NOT NULL DEFAULT 'queued',
  assignee_preset      TEXT,
  capability_token_hash TEXT,
  params_json          TEXT NOT NULL DEFAULT '{}',
  acceptance_json      TEXT NOT NULL DEFAULT '[]',
  baseline_value       REAL,
  target_value         REAL,
  measure_metric       TEXT,
  measure_at           TEXT,
  measure_window_days  INTEGER,
  attempt              INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, created_at);

-- 任务只能挂在已批准的决策上。应用层也会校验，这里是最后一道闸。
CREATE TRIGGER IF NOT EXISTS trg_tasks_require_approved
BEFORE INSERT ON tasks
WHEN (SELECT status FROM decisions WHERE id = NEW.decision_id) IS NULL
  OR (SELECT status FROM decisions WHERE id = NEW.decision_id) NOT IN
     ('approved', 'dispatched', 'executing', 'submitted', 'verifying', 'verified', 'measuring', 'closed')
BEGIN
  SELECT RAISE(ABORT, 'task requires an approved decision');
END;

CREATE TABLE IF NOT EXISTS task_runs (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id),
  session_id TEXT,
  trigger    TEXT NOT NULL DEFAULT 'dispatch',   -- dispatch | retry | manual
  status     TEXT NOT NULL DEFAULT 'running',
  model      TEXT,
  tokens_in  INTEGER,
  tokens_out INTEGER,
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  error      TEXT,
  started_at TEXT NOT NULL,
  ended_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_task_runs_task ON task_runs(task_id, started_at);

CREATE TABLE IF NOT EXISTS artifacts (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id),
  kind       TEXT NOT NULL,                -- file | url | draft | image | pr
  path       TEXT,
  url        TEXT,
  sha256     TEXT,
  meta_json  TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS verifications (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id),
  checks_json TEXT NOT NULL DEFAULT '[]',
  verdict     TEXT NOT NULL,               -- pass | fail | needs_human
  verified_by TEXT NOT NULL,               -- human | ceo-agent | rule
  comment     TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outcomes (
  id             TEXT PRIMARY KEY,
  task_id        TEXT NOT NULL REFERENCES tasks(id),
  metric_key     TEXT NOT NULL,
  baseline_value REAL,
  target_value   REAL,
  measured_value REAL,
  verdict        TEXT NOT NULL,            -- improved | no_change | worse | unmeasured
  measured_at    TEXT NOT NULL,
  note           TEXT
);

CREATE TABLE IF NOT EXISTS knowledge_docs (
  id         TEXT PRIMARY KEY,
  module_id  TEXT,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  tags_json  TEXT NOT NULL DEFAULT '[]',
  links_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
  title, body, tags_json,
  content='knowledge_docs', content_rowid='rowid',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS knowledge_ai AFTER INSERT ON knowledge_docs BEGIN
  INSERT INTO knowledge_fts(rowid, title, body, tags_json)
  VALUES (new.rowid, new.title, new.body, new.tags_json);
END;

CREATE TRIGGER IF NOT EXISTS knowledge_ad AFTER DELETE ON knowledge_docs BEGIN
  INSERT INTO knowledge_fts(knowledge_fts, rowid, title, body, tags_json)
  VALUES ('delete', old.rowid, old.title, old.body, old.tags_json);
END;

CREATE TRIGGER IF NOT EXISTS knowledge_au AFTER UPDATE ON knowledge_docs BEGIN
  INSERT INTO knowledge_fts(knowledge_fts, rowid, title, body, tags_json)
  VALUES ('delete', old.rowid, old.title, old.body, old.tags_json);
  INSERT INTO knowledge_fts(rowid, title, body, tags_json)
  VALUES (new.rowid, new.title, new.body, new.tags_json);
END;

-- 审计链：hash = sha256(prev_hash + canonical_json(event))，只追加。
CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  before_hash TEXT,
  after_hash  TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}',
  prev_hash   TEXT,
  hash        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
