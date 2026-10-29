# 安装与验收记录

记录人：Agent（DeepSeek-V4.1-Flash）
日期：2026-10-25
Desktop 版本：`D:\Program Files\dsh-desktop\DSH Desktop\DSH Desktop.exe` · Electron 43.0.0 · 内置 Node v24.17.0
包版本：`dsh-agent-new-media-studio@0.1.1`

## 1. 技术 spike 结论

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| `node:sqlite` 在 Desktop 运行时可用 | ✅ | 用 `DSH Desktop.exe` + `ELECTRON_RUN_AS_NODE=1` 跑 `DatabaseSync(':memory:')`，建表、写入、查询都通过 |
| FTS5 可用 | ✅ | `CREATE VIRTUAL TABLE … USING fts5(...)` 成功，`tokenize='trigram'` 支持中文子串检索（默认 unicode61 把整句当一个词，中文搜不到） |
| WAL | ✅（未直接验证） | 内存库报 `journal_mode=memory`，属正常；文件库沿用 `PRAGMA journal_mode = WAL`，未单独断言 |
| 需要原生依赖 | ❌ 不需要 | 只用 `node:sqlite`，没有 `better-sqlite3`，包内无二进制 |

## 2. 包与配置

- `pnpm pack` 产物：`dsh-agent-new-media-studio-0.1.1.tgz`，约 30 KB，10 个文件。
- `tar -tzf` 已核对：`package.json`、`cordis.patch.yml`、`dsh/{index,db,http,modules}.js`、`dsh/schema.sql`、`lib/client.js`、`README.md`、`LICENSE`。
- 用临时 `DSH_HOME` 装进一个独立 profile：
  ```
  DSH_HOME=<tmp>/ans-home dsh plugin --profile web add <abs>/dsh-agent-new-media-studio-0.1.1.tgz
  ```
  输出 `+ dsh-agent-new-media-studio 0.1.1`，profile 的 `dsh.profile.bundles` 自动加入本包。
- `dsh --profile web --dump-config` 出现本包插件层：
  ```yaml
  - id: agent-new-media-studio
    name: dsh-agent-new-media-studio
    config:
      root: !!js dshHomePath('agent-new-media-studio')
  ```

## 3. 宿主加载实测（纯 Web 形态）

启动 `dsh --profile web`（临时 DSH_HOME），在浏览器打开后：

- `GET /api/agent-new-media-studio/health` → `200 {"ok":true,"db":"ready"}`
- `GET /api/agent-new-media-studio/bootstrap` → 6 个模块、6 个数据源、审计链 `ok: true`
- 首屏提示 `dsh-agent-new-media-studio: pending (waiting for service: desktopWorkbenches)`。
  **这条是预期行为，不是缺陷**（v0.2.0 已纠正认知）：插件在客户端声明了
  `inject: ['desktopWorkbenches']`，Cordis 会一直挂起等这个服务；纯 `dsh --profile web`
  没有 Desktop 工作台宿主，所以永远 pending。同一个 Harness 里参考插件
  `dsh-workbench-personal-social-local` 也是同样的 pending 提示，可以互证。
  在 Desktop 里 `desktopWorkbenches` 由宿主注入，插件正常激活。
  v0.1.1 里加的「服务不存在就跳过注册」保留着，作为纯 Web 形态下的防御，不影响 Desktop。

## 4. 本机测试

```
npm test   → 6/6 通过
```
覆盖：库结构与 FTS 中文检索、任务必须先有已批准决策（触发器）、审计链篡改检测、数据新鲜度三色、本机 API（健康检查 / 引导 / 写操作头校验 / 暂停落审计）、非回环请求拒绝。

## 5. 界面结构验收（浏览器预览，不是 Desktop 内验收）

用 `scripts/make-preview.mjs` + `scripts/preview-server.mjs` 把 `lib/client.js` 挂到 React 上，接真实本机 API：

- 1440×900：总览、模块、设置、数据源四页渲染正常，无控制台报错。
- 620×720 窄容器：侧栏自动收成图标栏，卡片单列，无横向溢出、无单字竖排。
- 顺手修复：根容器在 flex 宿主里被 `flex-shrink` 压成 0 宽（已补 `flex: 1 1 auto`）。

## 8. v0.2.0 界面改版（对齐参考视频）

用户给了参考视频的截图（`C:\Users\Administrator\Downloads\测试\shots`，40 组首尾帧）和 13151 张帧图，
并说明要的是那个效果。原始实现源码在 `C:\Users\Administrator\Downloads\测试\dsh-ai-company-dashboard`
（FastAPI + SQLite + 独立 Python 后端，客户端里全是写死的示例数据）。

处理方式：**取形态，不取假数据**。

- 顶栏 7 Tab：总览 / 电商 / 内容 / 开源 / 投资 / AI 工作 / 待办（+ 数据源、设置从右上齿轮进）。
- 树状拓扑：创始人卡（等你 N 件）→ 两条管道（拍板 / 汇报）→ CEO 卡 → 6 路分支。
  连线用内联 SVG，每条一条模块色曲线 + `animateMotion` 光点。
- Agent 卡：线框图标 + 模块名 + 状态点 + 大号主指标 + 「上次 → 下次」。点开进该模块详情页。
- 详情页：14 天柱图（快照相减；空柱表示没数据；今天淡红）、数据源明细、可执行动作（R1/R2/R3）、问这个 Agent。
- company.log 审计流、`/detail/<moduleId>`、`/today` 三个新接口都由真实 SQLite 数据驱动。

本地验证（预览，不是 Desktop 内验收）：

- 空库：6 个 Agent 全灰灯，`待采` / `未接数据源`，柱图全空，提示「先接入一个数据源」。
- 造数（`scripts/seed-demo.mjs` 写进临时库）：内容 Agent 亮红灯（1 个源超过阻断线）、
  待办角标 1、柱图出现 +210/-150/+380 等真实差值、审计流两条。
- 顺手修的：柱图为 0 时被画成满高（今天那根）、`/detail` 用 prefix 路由、`history` 字段 SQL 拼错。

注意：参考实现里的 `repository` 是占位身份，本包没有沿用它。

## 9. 已装进真实 Desktop profile（含证据）

`dsh plugin --profile web add` 在本机不可用（pnpm store 版本冲突，见下），所以按参考插件 README
的等价做法手工注册：

| 动作 | 位置 |
| --- | --- |
| junction 链接 | `%APPDATA%\dsh-desktop\harness\profiles\web\node_modules\dsh-agent-new-media-studio` → 本仓库 |
| `dependencies` 增加 | `"dsh-agent-new-media-studio": "link:D:/Github/DSH工作台/DOUYIN/自媒体工作台"` |
| `dsh.profile.bundles` 末尾追加 | `dsh-agent-new-media-studio` |
| 备份 | `profiles/web/package.json.bak-ans-20261026-125529` |

证据（用同一个 Desktop harness 的 profile 起一次 `dsh --profile web --port 3214`）：

- `window.__DSH_BOOT__` 共 83 条 entry，其中包含 `dsh-agent-new-media-studio`
  → 宿主确实扫描到了本包的客户端模块并下发到浏览器。
- 同一页面里本包状态是 `pending (waiting for service: desktopWorkbenches)`，
  参考插件 `dsh-workbench-personal-social-local` 同样 pending —— 因为 `dsh --profile web`
  不是 Desktop，没有工作台宿主服务。在 Desktop 里该服务存在，插件会正常激活。

回滚：还原上面那个 `.bak`，并删掉 junction，重启 Desktop 即可。

### 本机 pnpm 存储冲突（既有问题，与本次改动无关）

```
dsh plugin --profile web add <tgz>
→ [ERR_PNPM_UNEXPECTED_STORE] dependencies at profiles/web/node_modules are linked from
  store v10, pnpm now wants store v11
```
这是 profile 当初用 pnpm 10 装、而 Desktop 内置 pnpm 11 导致的，所有插件的 CLI 安装都会撞上。

### 顺带发现（不属于本包）

同一个 profile 里有 4 个插件被 harness 跳过：
`dsh-desic-terminal@0.1.0`、`dsh-toonflow@0.1.0`、`dsh-content-workbench@0.2.1`、`dsh-site-selection@1.2.2`，
原因都是 peer 依赖写的是 `@deepseek-ai/dsh-host-webserver` 的 `<0.2.0-0` 区间，
而当前运行时是 `0.2.1-rc.2`。要恢复得给它们 `dsh plugin allow-version` 或升级。
本包没有声明这类 peer，所以不受影响。

## 10. 尚未实测（必须由 Desktop 内的人完成）

- [ ] 完整退出并重开 DSH Desktop → 左侧顶部工作台切换器里出现「Agent New Media Studio」。
- [ ] 打开后 6 路 Agent 都渲染出来（空库时应全是灰灯、`待采`、柱图全空）。
- [ ] `问 CEO` 打开右侧抽屉 → `开始工作台会话` 能创建并归属到本工作台的会话 → 草稿填进输入框。
- [ ] 顶部工具栏在紧凑模式下与宿主拖动区域不冲突（`data-dsh-workbench-toolbar` 已按规范标注）。
- [ ] 侧栏展开/收起、全屏进出、窄窗口下的重排。

## 11. 身份已就绪

仓库已创建并推送：`https://github.com/zhifanluosheng/dsh-ai-native-company`（public，main 分支）。
`package.json`、客户端 `REPOSITORY`、`scripts/verify-package.mjs` 三处身份现在一致，
`npm run check` 通过。
