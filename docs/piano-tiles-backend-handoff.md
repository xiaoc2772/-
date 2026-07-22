# 钢琴块（Piano Tiles）后端交接文档

> 交接对象：GPT-5.6。前端、谱面素材管线、网关路由已由 Claude 完成并合入。
> 本文档是后端实现的唯一规格来源，样板代码参照 `backend/internal/minesweeper/`。

## 1. 背景与已完成部分

游戏中心新增"钢琴块"音乐节奏游戏（`/games/piano-tiles`），玩法：4 轨下落音块，点击演奏旋律。两种模式：

| 模式 | mode 值 | 规则 |
|---|---|---|
| 经典 | `classic` | 按序击打全部音块，点错/漏块即失败；完成度+连击计分 |
| 限时冲刺 | `rush` | 固定 60s（谱面不足时循环），漏块/点错不结束，断连击+扣 2 分 |

已完成（勿改）：
- 前端页面 `src/app/games/piano-tiles/page.tsx`（后端 404/网络失败时自动降级"离线试玩"，接入后自动恢复计分模式）
- 前端引擎 `src/lib/piano-tiles/engine.ts` —— **判定与计分规则的权威参考，Go 引擎必须按相同常量重算**
- 谱面资产 `public/games/piano-tiles/charts/<id>.json` + `manifest.json`（810 首，由 `scripts/import-piano-assets.mjs` 生成）
- 网关 `gateway/Caddyfile` 已为下述 5 端点开洞

## 2. 需实现的文件清单

| 文件 | 说明 | 样板 |
|---|---|---|
| `backend/internal/pianotiles/types.go` | GameType 常量 `piano_tiles`、Session/Record/Input/StatusView | `minesweeper/types.go` |
| `backend/internal/pianotiles/engine.go` + `engine_test.go` | 服务端核分引擎（见 §5） | `minesweeper/engine.go` |
| `backend/internal/pianotiles/service.go` | start/checkpoint/submit/cancel 事务逻辑 | `minesweeper/service.go` |
| `backend/internal/pianotiles/charts.go` | go:embed 谱面摘要数据（见 §6） | 新增 |
| `backend/internal/httpserver/piano_tiles_handlers.go` + 单测 + 集成测试 | HTTP 层 | `minesweeper_handlers*.go` |
| `backend/internal/httpserver/server.go` | 注册 handlers（~44 行）+ `api.Route("/games/piano-tiles", ...)`（~245 行），末尾 `notMigratedHandler("piano_tiles")` 兜底 | 现有各游戏 |
| `backend/internal/gamesummary/service.go` | `piano_tiles` 加入白名单（28-29 行）、SQL IN（187 行）、isWin 判定（241 行起：`classic` 完成=win，`rush` 与 whack-mole 对齐按 score>0）、key 映射 `piano_tiles`→`piano-tiles`（278 行下划线转连字符已通用，确认即可） | — |

**无需新数据库迁移**：复用 `game_sessions` / `active_game_sessions` / `game_cooldowns` / `game_daily_stats` / `daily_game_points` 通用表（game_type = `piano_tiles`）。

## 3. API 契约

统一响应信封与错误码沿用 `writeServiceError` 约定（`{success, data?, message?}`）。所有端点要求登录会话，未登录 401。

### GET /api/games/piano-tiles/status
```json
{ "success": true, "data": {
  "inCooldown": false, "cooldownRemainingMs": 0,
  "pointsLimitReached": false,
  "dailyStats": { "plays": 3, "points": 120 },
  "activeSession": null
} }
```
`activeSession` 非空时为 `{ "sessionId": "...", "chartId": "101", "mode": "classic", "startedAt": <ms> }`。

### POST /api/games/piano-tiles/start
请求：`{ "chartId": "101", "mode": "classic" | "rush", "checksum": "8 位十六进制" }`
- 校验 chartId 存在于 embed 谱面表、checksum 与服务端记录一致（不一致 → 400 `chart checksum mismatch`，表示前端资产被篡改或版本不一致）
- 冷却中 / 已有活跃会话按 minesweeper 语义处理
- 响应：`{ "success": true, "data": { "sessionId": "...", "startedAt": <server ms> } }`

### POST /api/games/piano-tiles/checkpoint
请求：`{ "sessionId": "...", "events": [ { "t": 12345, "lane": 2, "j": "p" } ] }`
- `t`：游戏内时钟毫秒（含 2000ms 前导）；`j`：`p`=perfect `g`=good `m`=miss `w`=wrong
- 追加存入会话 state（JSON 数组），校验见 §5；非法直接 409 使会话失效（标记 failed）
- 前端每 5s 批量上报；网络丢包时事件会在 submit 里全量兜底重传，checkpoint 需按 `t` 去重合并

### POST /api/games/piano-tiles/submit
请求：
```json
{ "sessionId": "...",
  "result": { "status": "completed|failed|timeup", "score": 123, "maxCombo": 30,
              "perfect": 80, "good": 15, "miss": 1, "wrong": 0, "playedMs": 95000 },
  "events": [ ...全量事件（兜底）... ] }
```
- **服务端以事件流重算得分，不信任 result**（result 仅用于对账，偏差超容忍度记日志并以服务端值为准）
- 幂等：同一会话重复 submit 返回首次结算记录（`findSettledRecord` 模式）
- 响应：`{ "success": true, "data": { "score": <服务端核算分>, "pointsAwarded": 45, "record": {...} } }`

### POST /api/games/piano-tiles/cancel
请求：`{ "sessionId": "..." }`；关闭活跃会话，无积分。

## 4. 判定与计分常量（与 `src/lib/piano-tiles/engine.ts` 保持一致）

```
JUDGE_PERFECT_MS = 90      // |dt| <= 90 → perfect
JUDGE_GOOD_MS    = 180     // |dt| <= 180 → good
MISS_AFTER_MS    = 180     // 超判定线 180ms 未击打 → miss
SCORE_PERFECT = 3; SCORE_GOOD = 2
COMBO_STEP = 10            // 每 10 连击每次击打 +1 分
COMBO_BONUS_MAX = 5        // 连击加成封顶 +5
RUSH_WRONG_PENALTY = 2     // rush 点错 -2（总分不低于 0）
RUSH_DURATION_MS = 60000
LEAD_IN_MS = 2000          // 前端音块时间整体后移 2000ms，事件 t 含此偏移
```
经典模式：任意 `m`/`w` 事件后不得再有击打事件（出现即判非法）。
rush 模式：谱面循环填满 60s（见前端 `createEngine` 的 rush 分支：音块序列 = 谱面 notes 按 durationMs 平移重复，截断至 60s）。

## 5. 防作弊校验规则（engine.go 核心）

对合并后的事件流逐条校验，任一失败 → 会话判 failed、submit 拒绝计分：
1. **时间单调性**：事件 `t` 非递减；`t` 不为负、不超过（谱面时长 + LEAD_IN + 5s 容差）
2. **节奏合法性**：`p`/`g` 击打事件与谱面音块按序一一对应（第 k 个击打事件对应第 k 个未判定音块），且 `|t - (note.t + LEAD_IN)| <= JUDGE_GOOD_MS`；lane 必须等于该音块 lane
3. **密度上限**：任意 1s 窗口内事件数 ≤ 30（人手极限富余量）
4. **计数一致性**：p+g+m 总数 ≤ 音块总数；completed 状态要求 p+g == 总音块数且无 m/w
5. **提交时序**：submit 的 playedMs 与服务端 `now - startedAt` 偏差 ≤ 10s
6. 得分由服务端按 §4 常量对事件流重算

## 6. 谱面数据下发到 Go（charts.go）

不 embed 完整谱面（28MB），只 embed 核分所需摘要：`{chartId: {checksum, durationMs, notes: [[t,lane,d], ...]}}`。
获取方式二选一：
- 在 `scripts/import-piano-assets.mjs` 里加 `--emit-go-summary <path>` 输出（推荐，重导入时同步更新）
- 或写一次性脚本从 `public/games/piano-tiles/charts/*.json` 抽取

生成后 `//go:embed charts_summary.json` 加载进内存 map。

## 7. 积分规则（service.go）

- 结算积分建议公式：`points = round(score / 10)`，classic 完成额外 +20，封顶单局 200
- 入账用共享的 `addGamePointsWithLimit` 模式 + `systemconfig.DailyPointsLimit(ctx, tx)`（超上限截断）
- 冷却：对齐 whack-mole（如 60s），写 `game_cooldowns`
- 每日统计写 `game_daily_stats` / `daily_game_points`

## 8. 联调验收清单

1. `GET status` 未登录 401，登录后返回信封结构
2. `start → checkpoint×N → submit` 全链路：前端真实打完一局，`pointsAwarded` 正确入账（钱包流水可见）
3. submit 幂等：重放同一 submit 请求返回相同 record，不重复加分
4. 篡改校验：伪造高分 result（events 不支撑）→ 服务端按事件重算，得分为事件流真实值
5. 密度攻击：注入 1s 内 100 条 `p` 事件 → 409/failed
6. checksum 不匹配 start → 400
7. 前端验证：后端上线后 `/games/piano-tiles` Hero 区不再显示"离线试玩"提示
8. `gamesummary`：游戏中心页 perGame 统计出现 piano-tiles 条目
9. Go 测试：`engine_test.go`（重算正确性 + 各作弊场景）、handlers 单测 + 集成测试全绿
