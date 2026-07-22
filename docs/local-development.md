# 本地开发与初始化

当前工程的完整运行形态是：

```text
浏览器 :8080
    └─ Caddy Gateway
       ├─ Next.js Web :3000
       └─ Go API :8080
          ├─ PostgreSQL 16
          └─ Redis 7

Go Worker 与 API 共用 PostgreSQL、Redis 和会话密钥。
```

## 推荐方式：Docker Compose

环境要求：

- Docker Desktop
- PowerShell 7 或 Windows PowerShell 5.1

首次初始化并启动：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-local.ps1
```

脚本会依次完成：

1. 校验 Docker 与 `compose.yml`。
2. 启动 PostgreSQL、Redis。
3. 构建 Go 镜像并执行全部数据库迁移。
4. 构建并启动 Gateway、Next.js、Go API、Go Worker。
5. 请求 `/healthz`，确认 PostgreSQL 与 Redis 可用。

启动成功后访问：<http://localhost:8080>

再次启动且代码、依赖没有变化时，可跳过镜像构建：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-local.ps1 -SkipBuild
```

常用命令：

```powershell
# 查看状态
docker compose -f compose.yml ps

# 查看最近日志
docker compose -f compose.yml logs --tail 200

# 停止服务（保留数据库和 Redis 数据卷）
docker compose -f compose.yml down
```

不要使用 `down -v`，除非明确要删除本地数据库、Redis 和反馈附件数据。

## 本地环境变量

仓库提供 `.env.example`。当前工作区已创建一个被 Git 忽略的 `.env`，包含仅供本地使用的随机密钥和默认端口。

常用配置：

- `APP_PORT`：统一入口端口，默认 `8080`。
- `POSTGRES_PORT`：宿主机 PostgreSQL 端口，默认 `5432`。
- `REDIS_PORT`：宿主机 Redis 端口，默认 `6379`。
- `ADMIN_USERNAMES`：管理员用户名白名单。
- `NEW_API_URL`：外部 new-api 服务地址；留空不影响启动，但登录、直充和用户同步不可用。
- `S3_*`：可选对象存储；留空时反馈附件保存在本地 Docker 数据卷。
- `RESEND_*`：可选邮件服务；留空时邮件通知不可用。

若端口已被占用，修改 `.env` 中对应端口后重新运行初始化脚本。

## 原生运行

前端要求 Node.js 22 LTS，后端要求 Go 1.23。原生运行还需要自行准备 PostgreSQL、Redis 和 Caddy 路由，因此只建议用于单独调试某个服务；完整联调优先使用 Docker Compose。

前端质量检查：

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

Go 单元测试：

```powershell
Set-Location backend
go test ./...
```

带 PostgreSQL 的集成测试必须使用独立测试库，并设置 `TEST_DATABASE_URL`，不要指向本地开发库或生产库。
