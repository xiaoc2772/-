# 钢琴块后端交接 v2 —— 玩法重构后的契约变更（增量）

> 交接对象：GPT-5.6。基于已完成的 v1 后端（`backend/internal/pianotiles/`）做增量修改。
> 背景：前端玩法已按用户要求重构为**钢琴块2 原版机制**，v1 的"判定窗口"核分模型不再适用。
> 权威规则参考：`src/lib/piano-tiles/engine.ts`（已重写）。

## 1. 新玩法（替代 v1 §4 的判定模型）

- 画面自动下滚，滚动进度 = 相机时间（谱面毫秒域）；每完成一圈提速 `+12%`（`LAP_SPEED_STEP=0.12`）
- 玩家按序点击黑块，**允许提前点**（只要块已进入可视窗口 `VIEW_WINDOW_MS=2200`，相机会加速追上）
- 点错列（白块）或黑块底边越界（容差 `MISS_GRACE_MS=60`，长按块加上时值 d）→ 立即失败
- **无 perfect/good 判定窗口**；命中 +1 分，长按块按住给 0–3 额外分（`HOLD_BONUS_MAX=3`）
- 曲目无限循环，前三圈各得一枚皇冠（`MAX_CROWNS=3`）；经典模式只能以失败或主动放弃结束
- rush 模式：同机制，60 秒墙钟到时 `timeup` 结束

## 2. 事件流变更（checkpoint / submit 的 `events`）

```json
{ "t": 12345, "lane": 2, "j": "h" }
```
- `j` 取值变更：`h`=命中（替代 v1 的 p/g）、`m`=漏块、`w`=点错；`m`/`w` 至多一条且必为最后一条
- `t` 语义变更：**墙钟毫秒**（自玩家点击"开始"块起算），不再对应谱面音块时刻——因为玩家可以快打，
  事件时间与谱面时间不再一一对应

## 3. submit 的 result 字段变更

```json
{ "status": "failed|timeup", "score": 123, "tilesHit": 120, "crowns": 2, "laps": 2, "playedMs": 95000 }
```
（不再有 perfect/good/miss/wrong/maxCombo；`status` 不再有 completed）

## 4. 服务端重放/校验规则（重写 engine.go 的 ReplayEvents）

对合并去重后的事件流：
1. `t` 非递减；首个事件 `t >= 0`
2. 第 k 个 `h` 事件对应第 k 个音块（音块序列 = 谱面 notes 无限循环，第 lap 圈时间平移 `lap*lapMs`，
   `lapMs = max(durationMs, last.t + max(last.d, 400))`——与前端 `createEngine` 一致）；
   lane 必须等于该音块 lane。**不校验 t 与音块时刻的偏差**（快打合法）
3. 节奏下限：相机至少按 1 倍速前进，第 k 个音块的命中墙钟时间不可能晚于
   `note_k.t + lap*lapMs + VIEW_WINDOW_MS + 宽限(5s)`（按 1 倍速上界从宽即可）
4. 节奏上限（防脚本）：任意 1s 窗口内事件 ≤ 30（沿用 v1 密度校验）；相邻 `h` 事件间隔 ≥ 25ms
5. `m`/`w` 后不得再有事件；status=failed 要求最后事件为 m/w；status=timeup 仅 rush 且 playedMs≈60s
6. `playedMs` 与服务端 `now - startedAt` 偏差 ≤ 10s（沿用 v1）
7. 服务端重算：score 基础分 = h 事件数；长按额外分不逐块重算，采信上限
   `score ≤ hits + hits*HOLD_BONUS_MAX`；crowns/laps = `floor(hits / totalNotes)`，crowns 封顶 3

## 5. 积分公式建议（替代 v1 §7）

- `points = round(score / 8) + crowns * 15`，单局封顶 200；rush 同式
- isWin（gamesummary）：`crowns >= 1`（classic）；rush 维持 score > 0
- 其余（幂等、冷却、每日上限、通用表、checksum 校验）不变

## 6. 验收清单（增量）

1. 快打场景：以 2 倍于谱面的速度提交合法 `h` 事件流 → 正常计分（v1 会拒绝，v2 必须通过）
2. 伪造 lane / 乱序事件 → 409
3. `m` 之后追加 `h` → 409
4. crowns 重算：hits = 2.5×totalNotes → laps=2, crowns=2
5. v1 既有验收项（幂等、密度、checksum、时长偏差）继续通过
6. 联调：前端打完一局（失败结束）→ `pointsAwarded` 正确；结算面板不再出现"规则待升级"提示

## 7. 现状说明

前端已按新契约上报（`j:'h'` 等）。在 v2 后端落地前，v1 后端会对新事件流返回 409，
前端已做兜底：显示"积分结算被服务端拒绝（规则待升级）"，游戏本身可正常游玩。
测试文件 `piano_tiles_handlers_integration_test.go` 中依赖 p/g 事件的用例需随 v2 一并更新。

## 8. v2.1 增量（音块生成模型对齐原作后的谱面数据变更）

前端按用户要求把音块生成改为原作的"无缝衔接"模型，谱面数据随之变更（已由
`node scripts/import-piano-assets.mjs --emit-go-summary backend/internal/pianotiles/charts_summary.json`
重新生成并落盘，Go embed 数据与前端 checksum 已同步，`engine_test.go` 中谱面 101 的
硬编码 checksum 已更新为 `68702451`）：

1. **`d` 语义变更**：摘要 `notes: [[t, lane, d]]` 中 `d` 现为**每个音符的真实时值毫秒**
   （旧版仅长按块有值、普通块为 0）。块高 = d，相邻音块 `t[k+1] = t[k] + d[k]`（休止处留空档）。
2. **checksum 全量变化**：810 首谱面 checksum 已重算，start 端点校验数据源不变。
3. **圈长公式**：前端为 `lapMs = max(durationMs, last.t + max(last.d, unitMs))`（unitMs =
   首段 baseBeats×每拍毫秒，每首不同）；Go 的 `LapDurationMS` 用固定下限 400ms。由于
   durationMs 几乎总是占优，两者仅在极端谱面差数百毫秒，且只影响 §4.3 的宽松下界校验
   （已有 5s 余量），**无需改动**；如追求严格一致可把 400 换为按谱面注入 unitMs。
4. **开始块**：前端开局多一个「开始」块（不计分、不上报事件），事件流仍从第一个真实
   音块开始，k-th `h` ↔ k-th note 的映射**不受影响**。
5. 长按块判定：`d >= 1.75 × unitMs`；长按额外分仍按 §4.7 的 `hits×3` 采信封顶。
