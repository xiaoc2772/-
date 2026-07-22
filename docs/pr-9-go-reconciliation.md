# PR #9 Go 迁移补接清单

## 当前结论

PR #9 仍是 GitHub 上的 open PR，尚未 merge 到 `main`。
当前 Zeabur GHCR 镜像从 `main` 构建，因此 PR #9 里的部分后台优化和兼容性改动不会出现在部署环境。

不能直接 merge PR #9：该 PR 基于旧 Cloudflare/Next 架构，直接合并会删除当前 `backend/`、Docker、Zeabur 文档和审计脚本等迁移成果。
正确策略是按功能逐块 cherry-pick/移植，并把涉及旧 Next API 的部分改成 Go/PostgreSQL/Redis。

## 已经接入或已有 Go 替代的部分

- 2048 素材已在 `main`。
- `src/app/games/2048/page.tsx` 已在 `main`，但与 PR #9 仍有差异，需单独复核。
- `backend/internal/game2048` 已实现 Go 规则、服务层和 HTTP handler。
- Gateway 已精确切流：
  - `/api/games/2048/status`
  - `/api/games/2048/start`
  - `/api/games/2048/checkpoint`
  - `/api/games/2048/submit`
  - `/api/games/2048/cancel`
- PR #9 后台 API 的 Go 替代已部分实现并切流：
  - `/api/admin/eco`
  - `/api/admin/points`
  - `/api/admin/users`
  - `/api/admin/users/*`
  - `/api/admin/dashboard`
  - `/api/admin/projects`
  - `/api/admin/projects/*`
  - `/api/admin/feedback`
  - `/api/admin/feedback/*`
- PR #9 后台环保入口和页面已补接到 `main`：
  - `src/components/admin/AdminSidebar.tsx`
  - `src/app/admin/eco/page.tsx`
- PR #9 浏览器兼容层已补接到 `main`：
  - `src/components/BrowserCompatibility.tsx`
  - `src/app/layout.tsx`
  - `src/app/globals.css`
- PR #9 后台项目自动暂停已迁到 Go 并补接页面：
  - `backend/migrations/0028_project_auto_pause.sql`
  - `backend/internal/welfare/admin_project.go`
  - `backend/internal/httpserver/welfare_handlers.go`
  - `backend/internal/worker/worker.go`
  - `src/app/admin/page.tsx`
  - `src/lib/time.ts`
- PR #9 后台反馈删除入口已补接到 `main`：
  - `src/app/admin/feedback/page.tsx`
- PR #9 后台用户管理页已按 Go/PostgreSQL 契约补接：
  - `backend/internal/adminusers/service.go`
  - `backend/internal/adminusers/types.go`
  - `backend/internal/httpserver/admin_user_handlers.go`
  - `src/app/admin/users/page.tsx`
  - 旧 `同步历史用户` / `迁移新人资格` 按钮不再展示，生产入口继续由 Go 墓碑路由返回 410。
- PR #9 后台仪表盘和后台项目详情已由 Go 版替代并复核：
  - `backend/internal/admindashboard/*`
  - `backend/internal/httpserver/admin_dashboard_handlers.go`
  - `src/app/admin/dashboard/page.tsx`
  - `src/app/admin/project/[id]/page.tsx`
  - 页面差异已复核，没有需要从旧 PR 原样补接的旧 KV 逻辑。
- PR #9 2048 排行榜漏项已补接：
  - `backend/internal/rankings/games.go`
  - `backend/internal/rankings/games_test.go`
  - `src/app/rankings/page.tsx`
  - `/api/rankings/games` 会返回 `game_2048` 分游戏榜。
- PR #9 v3.0 更新公告内容已补接：
  - 当期版本公告（历史上为 `3.0更新公告.md`）
  - 文案已按当前 Go 版口径修正，不再宣称旧 `games/fallback` 兜底结算或 Go 契约不存在的环保追回保护字段。
- PR #9 首页公告/抽奖可见 UI 已补接：
  - `src/app/page.tsx`
  - `src/app/store/page.tsx`
  - `src/app/project/[id]/page.tsx`
  - `src/components/MarkdownPreview.tsx`
  - 公告弹窗支持 Markdown 预览。
  - 首页抽奖卡、商店抽奖卡、抽奖详情页和弹窗支持 `triggerType = scheduled` 与 `scheduledDrawAt` 展示。
  - 后端字段由 Go/PostgreSQL 的 `raffles.scheduled_draw_at_ms` 提供，不恢复旧 Next 定时维护接口。
- PR #9 后台抽奖定时开奖 UI 已按 Go 契约补接并加强：
  - `src/app/admin/raffle/page.tsx`
  - `src/app/admin/raffle/[id]/page.tsx`
  - `src/app/admin/raffle/create/page.tsx`
  - 页面提交 `scheduledDrawAt` 时使用中国时间输入转换后的毫秒时间戳，而不是旧 PR 的字符串时间。
- PR #9 通知页 Markdown 展示已补接：
  - `src/app/notifications/page.tsx`
  - 公告/系统通知详情使用 `MarkdownPreview`。
  - 弹窗内容区支持滚动，列表摘要保持两行预览。
  - API 继续使用 Go/PostgreSQL 的 `/api/notifications/*`，不恢复旧 `src/lib/notifications.ts` 写路径。
- PR #9 后台公告页已补接并由 Go API 支撑：
  - `src/app/admin/announcements/page.tsx`
  - `backend/internal/announcements/*`
  - `backend/internal/httpserver/announcement_handlers.go`
  - 已通过 `go test ./internal/announcements ./internal/httpserver -run "Announcement|Announcements"`。
- PR #9 认证核心路径已由 Go 接管并补入生产审计：
  - `backend/internal/httpserver/auth_handlers.go`
  - `backend/internal/httpserver/auth_session.go`
  - `scripts/smoke-auth-login-go-api.mjs`
  - `scripts/smoke-auth-me-go-api.mjs`
  - `scripts/smoke-auth-logout-go-api.mjs`
  - `scripts/audit-production-cutover-readiness.mjs`
  - `scripts/audit-production-cutover-evidence.mjs`
  - Gateway 只允许 `/api/auth/login`、`/api/auth/me`、`/api/auth/logout` 三个精确路径，不恢复旧 Next/KV auth wrapper 作为生产路径。
- PR #9 星尘迷阵页面差异已复核：
  - `src/app/games/roguelite/page.tsx`
  - 当前 Go 版保留旧会话/缺字段安全渲染、状态同步兜底和服务端权威结算。
  - 不恢复 PR #9 的 `requestGameFallback` 旧前端兜底结算。
  - 已通过 `go test ./internal/roguelite ./internal/httpserver -run "Roguelite|GameSummary"`。
- PR #9 其他游戏/环保页差异已复核：
  - `src/app/games/linkgame/*`
  - `src/app/games/match3/*`
  - `src/app/games/memory/*`
  - `src/app/games/minesweeper/page.tsx`
  - `src/app/games/whack-mole/page.tsx`
  - `src/app/games/eco/page.tsx`
  - 当前 Go 版保留精确登录跳转和服务端结算，不恢复旧 `games/fallback`。
  - `rg "requestGameFallback|game-fallback|games/fallback|_lib/fallback" src backend scripts` 无代码残留。

## 当前仍缺的 PR #9 前端/页面改动

当前这一轮已未发现必须继续原样补接的 PR #9 页面改动；剩余差异主要是旧 Next API、旧 KV/TS 业务库或当前 Go 版更强的替代实现。

本轮复核补充：

- 2048 排行榜已补接到 Go 排行榜配置和前端排行榜页，`/api/rankings/games` 会把 `game_2048` 作为独立游戏榜返回。
- 2048 素材、封面和吉祥物已存在；历史版本公告曾补接并修正文案以匹配 Go 版服务端权威结算。版本公告会随发布迭代，不再作为长期发布门禁。
- `src/app/games/2048/page.tsx` 和 PR #9 的剩余差异是有意保留：当前版本移除了旧 `requestGameFallback`，401 时跳转登录，结算只认 Go 服务端。
- `src/app/games/eco/page.tsx` 中 PR #9 的 `stealProtectedUntil` / `theftCaughtCount` 展示没有原样恢复，因为当前 Go `EcoPublicBoardView` 契约没有这些字段；继续展示已偷盗状态、偷盗留言、服务端返回的 `stealDisabledReason`。
- 后台用户页没有恢复 `同步历史用户` / `迁移新人资格` 两个按钮；这两个旧工具入口在当前 Go 生产路径中是墓碑化/禁用语义。

后续如果继续补接页面，仍按以下要求：

1. 页面可直接使用已切到 Go 的后台 API 时，优先保留页面改动。
2. 页面依赖尚未 Go 化的 API 时，先标记阻塞，不把旧 KV 写路径带进生产。
3. 每个后台页面补接后必须做页面级 smoke 或至少 API mock/未登录边界验证。

## PR #9 API/运行时差异处置

这些文件仍在 PR #9 与当前 `main` 的差异里，但不能原样接入。
其中不少路径已经有 Go/PostgreSQL/Redis 替代实现，旧 Next 文件只作为源码残留或回退源码存在：

- `src/app/api/internal/scheduled-maintenance/route.ts`
- `src/app/api/games/fallback/route.ts`
- `src/app/api/announcements/route.ts`
- `src/app/api/notifications/route.ts`
- `src/app/api/store/topup/route.ts`
- `src/app/api/store/withdraw/route.ts`
- `src/app/games/_lib/fallback.ts`
- `src/lib/game-fallback.ts`

处理原则：

1. `auth/login`、`auth/me`、`auth/logout` 已由 Go 精确切流；旧 Next route 文件只作为回退源码存在，不继续加固旧 KV。
2. `announcements` 已由 Go/PostgreSQL 实现并精确切流；旧 Next/KV 公告业务库不再恢复。
3. `notifications` 已有 Go 实现，页面展示已补接；旧 Next/KV 通知业务库不再恢复。
4. `store/topup`、`store/withdraw` 已由 Go 钱包服务实现并精确切流；生产依赖 Zeabur 正确配置 new-api access token。
5. `scheduled-maintenance` 已由 Go Worker/显式 internal cron 墓碑化方向接管，不作为生产 Next API 暴露。
6. `games/fallback` 和 `game-fallback` 已确认不恢复；生产以 Go 服务端结算为唯一权威。

## 当前仍缺的 PR #9 游戏与业务库改动

这些是旧 TypeScript 业务层的优化，不能盲目覆盖，因为当前高频路径已经由 Go 接管：

- `src/lib/memory.ts`
- `src/lib/match3.ts`
- `src/lib/whack-mole.ts`
- `src/lib/minesweeper.ts`
- `src/lib/linkgame-server.ts`
- `src/lib/roguelite.ts`
- `src/lib/game-2048.ts`
- `src/lib/eco.ts`
- `src/lib/eco-engine.ts`
- `src/lib/farm-v2/index.ts`
- `src/lib/wallet.ts`
- `src/lib/points.ts`
- `src/lib/raffle.ts`
- `src/lib/notifications.ts`
- `src/lib/anomaly-detector.ts`
- `src/lib/hot-d1.ts`
- `src/lib/kv.ts`
- `src/lib/new-api.ts`
- `src/lib/profile.ts`
- `src/lib/rankings.ts`
- `src/lib/feedback.ts`
- `src/lib/time.ts`

处理原则：

1. 已经由 Go 接管的结算逻辑，不把 TypeScript 旧逻辑重新变成权威实现。
2. 如果 PR #9 修的是前端展示兼容、请求重试、降级提示，可以移植到页面层。
3. 如果 PR #9 修的是旧 KV 并发、补偿、发奖逻辑，应迁移到对应 Go service 或 worker。
4. 每个迁移点都必须补 Go 测试或 smoke，不以 TypeScript 旧测试通过作为生产切流依据。

## 建议补接顺序

1. 后台导航和页面可见性：
   - `AdminSidebar`
   - `/admin`
   - `/admin/eco`
2. 已有 Go API 支撑的后台页：
   - `/admin/dashboard`
   - `/admin/users`
   - `/admin/projects`
   - `/admin/feedback`
   - `/admin/raffle`
3. 通用前端组件：
   - `BrowserCompatibility`
   - `MarkdownPreview`
4. 游戏前端差异复核：
   - `src/app/games/2048/page.tsx`
   - `src/app/games/roguelite/page.tsx`
   - `src/lib/game-2048.ts`
   - `src/lib/__tests__/game-2048.test.ts`
5. 通知、公告、认证、钱包等 API 改动按第 14 节 A/B 阶段迁到 Go。
6. scheduled maintenance 改为 Go Worker，不接旧 Next route。

## 每小块 review 要求

每接一块 PR #9 内容，都要记录：

1. 来源文件：PR #9 中对应文件。
2. 接入方式：原样移植、改写为 Go、只保留前端、或放弃。
3. API 归属：Go、Next 页面辅助、或待迁移。
4. 验证命令：typecheck、Go test、模块 smoke 或页面 smoke。
5. 部署影响：是否需要重新构建 GHCR 镜像，是否需要新环境变量。

## 机器审计

PR #9 Go 对账关键不变量由以下命令检查：

```bash
npm run audit:pr-9-go-reconciliation
```

该审计覆盖：

1. 2048 排行榜必须同时存在于 Go `supportedGames`、Go 测试和前端排行榜页。
2. 2048 素材、封面和吉祥物必须存在。
3. 当前版本公告应使用 Go 版服务端权威结算口径，但版本化公告文件不再作为长期发布门禁。
4. 2048 与星尘迷阵页面不得恢复 `requestGameFallback`。
5. 环保页不得展示 Go 契约不存在的 `stealProtectedUntil` / `theftCaughtCount`。
6. 后台用户页不得恢复旧 `同步历史用户` / `迁移新人资格` 按钮。
