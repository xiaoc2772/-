# 兑换码分发与活动平台

> **当前本地运行入口已迁移为 Next.js + Go API/Worker + PostgreSQL + Redis + Caddy。**
> 推荐直接运行 `powershell -ExecutionPolicy Bypass -File scripts/setup-local.ps1`，
> 完整说明见 [`docs/local-development.md`](docs/local-development.md)。下方部分
> Cloudflare/OpenNext 内容属于历史部署说明，不应作为当前本地初始化依据。

一个以 **Next.js 16 + Cloudflare Workers/OpenNext** 为主部署形态的活动平台，最初用于兑换码分发，现已扩展为包含 **项目领取、直充、抽奖、多人抽奖、积分商城、卡牌、小游戏、公告、反馈墙、通知与管理后台** 的完整应用。

> 当前仓库是 **Cloudflare-first** 方案：
> - 主运行时：Cloudflare Workers
> - 主数据存储：Cloudflare D1
> - 图片与增量缓存：Cloudflare R2
> - 非 Cloudflare 运行时保留了部分 `@vercel/kv` 兼容回退逻辑，但**完整功能以 Cloudflare 部署为准**。

---

## 功能概览

### 核心业务
- **项目领取**：支持兑换码发放 / 直充额度发放
- **新人福利**：支持新用户专属项目资格
- **积分体系**：签到、游戏、兑换、流水记录
- **积分商城**：兑换抽奖次数、卡牌抽数、直充额度等
- **单人抽奖**：档位概率、库存、直充模式
- **多人抽奖**：参与、开奖、异步发奖队列、重试
- **卡牌系统**：抽卡、库存、碎片、奖励、专辑页
- **小游戏**：老虎机、弹珠台、塔防爬塔、记忆翻牌、连连看、消消乐、农场
- **反馈墙**：用户反馈、管理员回复、图片外链化
- **公告与通知**：公告管理、奖励通知、未读状态
- **管理后台**：项目、用户、奖励、抽奖、卡牌、反馈、仪表盘、配置

### 已落地的安全/稳定性措施
- HMAC 签名 Session
- Session 吊销与全量失效
- 登录失败锁定 + 速率限制
- 登录重定向安全校验
- 项目领取与多人抽奖参与的并发锁保护
- API 来源校验
- 页面/API 统一安全响应头
- 多人抽奖发奖幂等与队列恢复

---

## 技术栈

- **框架**：Next.js 16（App Router）
- **语言**：TypeScript
- **UI**：React 19 + Tailwind CSS 4
- **运行时**：Cloudflare Workers（通过 `@opennextjs/cloudflare`）
- **数据层**：Cloudflare D1（主） / `@vercel/kv` 兼容回退（辅）
- **对象存储**：Cloudflare R2
  - OpenNext 增量缓存 Bucket
  - 反馈图片 Bucket
  - 卡牌图片 Bucket
- **测试**：Vitest
- **代码检查**：ESLint

---

## 当前部署形态

### Cloudflare 绑定（以 `wrangler.jsonc` 为准）
- `KV_DB`：D1 数据库
- `NEXT_INC_CACHE_R2_BUCKET`：OpenNext 增量缓存
- `FEEDBACK_IMAGES`：反馈图片存储
- `CARD_IMAGES`：卡牌图片存储
- `ASSETS`：静态资源
- `WORKER_SELF_REFERENCE`：Worker 自引用，用于 Cron 调本服务
- `IMAGES`：Cloudflare Images 绑定

### Worker 包装器
`worker-wrapper.mjs` 额外处理两件事：
1. 转发正常请求给 OpenNext 产物
2. 响应 Cron，调用 `/api/internal/raffle/delivery` 处理多人抽奖发奖队列

---

## 环境要求

- Node.js **20 / 22 / 25** 均可，推荐 **LTS**
- npm 10+
- Cloudflare 部署需要：
  - Wrangler 4+
  - D1 / R2 已创建

---

## 本地开发

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

建议在本地创建 `.env.local`。

```env
# 必填：new-api 服务地址
NEW_API_URL=https://your-new-api.example.com

# 必填：至少 32 位随机字符串
SESSION_SECRET=replace-with-a-long-random-secret-at-least-32-chars

# 必填：管理员用户名白名单，逗号分隔
ADMIN_USERNAMES=admin,lucky

# 可选：后台执行直充 / 用户同步等管理员能力
NEW_API_ADMIN_USERNAME=your-admin-username
NEW_API_ADMIN_PASSWORD=your-admin-password

# 可选：发奖队列内部任务鉴权（二选一即可）
RAFFLE_DELIVERY_CRON_SECRET=replace-with-a-random-secret
# CRON_SECRET=replace-with-a-random-secret

# 可选：发奖队列单次处理任务数（1~20）
RAFFLE_DELIVERY_CRON_MAX_JOBS=20

# 可选：用于 Proxy 中的来源校验
NEXT_PUBLIC_BASE_URL=https://your-domain.example.com

# 可选：R2 公网域名前缀，用于反馈图片外链 URL
R2_PUBLIC_URL=https://r2.example.com

# 仅在非 Cloudflare 运行时 / Vercel 回退模式下需要
KV_REST_API_URL=your-vercel-kv-url
KV_REST_API_TOKEN=your-vercel-kv-token

# 仅旧版反馈图片迁移脚本需要
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxx
```

### 3. 启动开发服务器

```bash
npm run dev
```

访问：<http://localhost:3000>

### 本地开发说明
- 本项目已调用 `initOpenNextCloudflareForDev()`，本地开发会读取 Cloudflare 相关配置。
- 如果你本地主要跑的是普通 Node/Next 环境，请准备 `KV_REST_API_URL` 与 `KV_REST_API_TOKEN` 作为存储回退。
- 如果你本地直接模拟 Cloudflare，可结合 `.dev.vars` / Wrangler 绑定使用。

---

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 本地开发 |
| `npm run build` | Next 生产构建 |
| `npm run start` | 启动 Next 生产服务 |
| `npm run lint` | ESLint 检查 |
| `npm run typecheck` | TypeScript 检查 |
| `npm test` | 运行 Vitest |
| `npm run preview` | OpenNext Cloudflare 本地预览 |
| `npm run deploy` | 部署到 Cloudflare Workers |
| `npm run upload` | OpenNext Cloudflare 上传 |
| `npm run cf-typegen` | 重新生成 Cloudflare 类型声明 |
| `npm run migrate:feedback-images` | 旧版反馈图片迁移 dry-run |
| `npm run migrate:feedback-images:execute` | 执行旧版反馈图片迁移 |

---

## 部署到 Cloudflare Workers（推荐）

### 1. 登录 Cloudflare

```bash
npx wrangler login
```

### 2. 创建 R2 Buckets

`wrangler.jsonc` 默认配置了以下 Bucket 名称：

```bash
npx wrangler r2 bucket create cache
npx wrangler r2 bucket create feedback-images
npx wrangler r2 bucket create card-images
```

### 3. 创建 / 绑定 D1

当前 `wrangler.jsonc` 中绑定名为：
- `KV_DB`

如果你在新账号/新环境部署，需要按自己的 D1 实际信息更新 `wrangler.jsonc` 中的：
- `database_name`
- `database_id`

### 4. 配置 Secrets / Variables

至少配置这些变量：
- `NEW_API_URL`
- `SESSION_SECRET`
- `ADMIN_USERNAMES`
- `RAFFLE_DELIVERY_CRON_SECRET` 或 `CRON_SECRET`

按需配置：
- `NEW_API_ADMIN_USERNAME`
- `NEW_API_ADMIN_PASSWORD`
- `RAFFLE_DELIVERY_CRON_MAX_JOBS`
- `R2_PUBLIC_URL`
- `NEXT_PUBLIC_BASE_URL`

### 5. 部署

```bash
npm run deploy
```

### 6. 本地预览（可选）

```bash
npm run preview
```

> Windows 原生环境下 OpenNext 相关构建偶尔不稳定，建议在 **WSL** 中执行 `preview / build / deploy`。

---

## Vercel / 非 Cloudflare 运行说明

代码中保留了以下兼容能力：
- `@vercel/kv` 读写回退
- 普通 Next 运行方式

但请注意：
- `FEEDBACK_IMAGES`、`CARD_IMAGES` 等 **R2 绑定能力是 Cloudflare 专用**
- `worker-wrapper.mjs` 的 **Cron + Worker 自调用** 也是 Cloudflare 专用
- 因此如果你需要 **完整功能**，请使用 Cloudflare 部署

如果只是临时在 Vercel / 普通 Node 环境运行核心业务，请至少保证：
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

---

## 多人抽奖发奖队列

### 触发方式
- Cloudflare Cron 通过 `wrangler.jsonc` 配置：
  - 默认 `0 3 * * *`（UTC）
- `worker-wrapper.mjs` 会自动调用：
  - `POST /api/internal/raffle/delivery`

### 鉴权
内部接口要求：
- `Authorization: Bearer <RAFFLE_DELIVERY_CRON_SECRET>`
- 或 `x-raffle-delivery-secret`

### 可调参数
- `RAFFLE_DELIVERY_CRON_MAX_JOBS`：单次 Cron 最多处理多少个队列任务，范围 `1~20`

### 特性
- 发奖幂等保护
- processing / delivered / uncertain 状态
- 处理中任务超时恢复
- pending 奖励延迟重试

---

## 反馈图片与卡牌图片

### 反馈图片
- 运行时使用 `FEEDBACK_IMAGES` R2 Bucket
- 可选 `R2_PUBLIC_URL`，用于返回公网可访问地址
- 若未绑定 `FEEDBACK_IMAGES`，外链化会失败

### 卡牌图片
- 运行时使用 `CARD_IMAGES` R2 Bucket
- Worker 层对 `/images/*` 做了缓存与 ETag 处理
- 若未绑定 `CARD_IMAGES`，图片请求会返回 `503`

---

## 质量门

当前仓库已通过：

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

---

## 项目结构（简化）

```text
src/
├─ app/
│  ├─ admin/                 # 管理后台页面
│  ├─ api/                   # API 路由
│  ├─ cards/                 # 卡牌页面
│  ├─ games/                 # 小游戏页面
│  ├─ lottery/               # 单人抽奖
│  ├─ raffle/                # 多人抽奖
│  ├─ feedback/              # 反馈墙
│  └─ store/                 # 积分商城
├─ components/               # 通用 UI 组件
├─ lib/
│  ├─ auth.ts                # 认证、Session、吊销
│  ├─ rate-limit.ts          # 限流
│  ├─ kv.ts                  # 业务数据访问
│  ├─ d1-kv.ts               # D1 兼容 KV 层
│  ├─ new-api.ts             # new-api 集成
│  ├─ lottery.ts             # 单人抽奖逻辑
│  ├─ raffle.ts              # 多人抽奖逻辑
│  ├─ points.ts              # 积分系统
│  ├─ store.ts               # 商店逻辑
│  ├─ rewards.ts             # 奖励批次
│  ├─ anomaly-detector.ts    # 仪表盘与异常检测
│  └─ ...
├─ proxy.ts                  # Next 16 Proxy（安全头 / 来源校验）
└─ __tests__/                # 测试
```

---

## 安全与运维提示

### 生产环境务必配置
- `SESSION_SECRET`：必须为高强度随机字符串，建议至少 32 位
- `ADMIN_USERNAMES`：必须明确配置管理员白名单

### 如果构建时看到这条警告
```text
ADMIN_USERNAMES not set in production, no admin users configured!
```
说明你没有给生产构建环境设置管理员名单。

### 登录跳转
项目已限制登录后的跳转目标为**站内安全路径**，避免开放跳转问题。

### 并发保护
以下关键路径已做锁保护：
- 项目领取
- 直充预占
- 多人抽奖参与

---

## 旧版反馈图片迁移脚本

仓库仍保留一个历史迁移脚本：
- `scripts/migrate-feedback-images-to-blob.mjs`

用途：
- 处理旧数据迁移到外部对象存储

使用前请确认：
- 已配置 `KV_REST_API_URL`
- 已配置 `KV_REST_API_TOKEN`
- 已配置 `BLOB_READ_WRITE_TOKEN`

示例：

```bash
npm run migrate:feedback-images
npm run migrate:feedback-images:execute
```

---

## License

MIT
