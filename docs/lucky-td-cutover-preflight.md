# 幸运塔防 Go 后端切流预检

本文用于 `/api/games/lucky-td/*` 从前端本地试玩兜底切到 Go API 前的检查。

## 覆盖路径

仅允许网关精确转发以下路径，禁止 `/api/games/lucky-td*` 或 `/api/games/*` 通配：

- `GET /api/games/lucky-td/status`
- `POST /api/games/lucky-td/start`
- `POST /api/games/lucky-td/checkpoint`
- `POST /api/games/lucky-td/submit`
- `POST /api/games/lucky-td/cancel`

## 数据表

M2 复用现有运行时表，不新增迁移：

- `game_sessions`
- `active_game_sessions`
- `game_records`
- `game_cooldowns`
- `game_daily_stats`
- `daily_game_points`
- `point_accounts`
- `point_ledger`

## 必跑检查

```bash
npm run check:lucky-td-config-sync
npm run audit:lucky-td-cutover
npx vitest run src/lib/lucky-td
cd backend && go test ./internal/luckytd ./internal/httpserver ./internal/gamesummary
```

如有临时 PostgreSQL 测试库，再追加集成测试与手工冒烟：

```bash
cd backend && TEST_DATABASE_URL=postgres://app:app@localhost:5432/app_test?sslmode=disable go test -tags integration ./internal/luckytd ./internal/httpserver
docker compose up --build
```

## 手工冒烟

1. 登录普通用户。
2. 打开 `/games/lucky-td`。
3. 确认状态接口返回 `activeSession`、今日统计、冷却和最近战绩。
4. 开始一局，至少完成一次波次结清，确认 `checkpoint` 返回新的 `expiresAt`。
5. 正常打到终局并提交，确认：
   - 返回 `score / pointsEarned / wavesCleared / status`
   - `game_records` 写入 `game_type = lucky_td`
   - `point_ledger` 有 `source = game_play`
   - 游戏中心 `/api/games/profile` 的 `perGame["lucky-td"]` 有统计
6. 点击放弃，确认会话删除并进入 5 秒冷却。

## 反作弊检查

- `submit` 只认 Go 引擎全量重放结果，`claimedScore` 仅作对照记录。
- `checkpoint` 会校验波次、帧数递增，并比对该波状态哈希。
- `submit` 会复核所有 checkpoint 哈希与终局重放一致。
- 配速审计要求真实耗时不低于 `finalFrame / 30 / 2`，允许 5 秒容差，并保留 10 秒最短对局时长（最快真实败局为 canyon 2 倍速 ≈ 10.5 秒墙钟）。
- 操作数上限来自配置 `engine.maxActions`，checkpoint 上限 20 次。

## M4 本地验证记录（2026-07-05，config v2）

平衡调整：config `version 2`，scorePermyriad grassland 10000→7500、canyon 12000→9000（×0.75 贴 350~500 基线）；黄金向量已重生成（胜局 639→479/478），双端字节一致。以下全部通过：

- 质量门：`check:lucky-td-config-sync`、`audit:lucky-td-cutover`、tsc、eslint、vitest 8 绿、gofmt / vet(-tags integration) / build、Go 三包测试（208 局向量零分歧）。
- `docker compose up --build` 全栈冒烟：web 200；未登录 401；status / start / cancel 经网关全链路 OK。
- 浏览器实测（本地栈）：多局真实提交结算，`claimedScore` 与服务器重放分全部一致；`point_ledger(source=game_play)`、`game_records` 落库、`/api/games/profile` 的 `perGame["lucky-td"]` 统计正确。
- 断线恢复：checkpoint(frame 521) → 刷新 → 恢复横幅（已同步步数）→ 快进重放 → 恢复后 checkpoint(frame 1027) 被服务器接受（哈希链跨断线连续）→ 放弃 → 会话删除 + 5 秒冷却 + 不发分。
- 移动端模拟：竖屏出「请横屏游玩」卫兵；横屏 844×390 布局正常。真机触控/性能仍需实机验证。

## 切流执行步骤（Zeabur，项目所有者执行）

1. 提交并推送 lucky-td 相关文件（引擎 / 前端 / 后端 / config v2 / 黄金向量 / Caddyfile / 0030 迁移）。
2. 生产数据库执行迁移：运行 api 镜像内 `/app/migrate`（0030 仅新增 `game_records(game_type, session_id)` 索引，幂等安全）。
3. 重新部署服务：api 与 web 必须同窗口上线（config v2 双端不同步会因状态哈希不一致拒绝 checkpoint），gateway 最后部署放流量（5 条精确转发生效）。
4. 生产验证（登录普通账号，按上文「手工冒烟」1~6 走一遍）。
5. 观察期（24h）：抽查 `game_records` 中 `payload->>'claimedScore'` 与 `score` 不一致的记录（双端分歧 / 作弊信号，正常应为零）；关注 submit 拒绝日志（配速审计）。

## 回滚方式

如生产发现异常，先从 `gateway/Caddyfile` 移除或注释五条 `lucky-td` 精确转发规则。

回滚后前端会重新落回 Next 404/非 JSON 兜底，并进入本地试玩模式，不计积分。无需改数据库结构。
