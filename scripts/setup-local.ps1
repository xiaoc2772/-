[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [ValidateRange(30, 600)]
    [int]$TimeoutSeconds = 240
)

$ErrorActionPreference = "Stop"
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$composeFile = Join-Path $projectRoot "compose.yml"
$envFile = Join-Path $projectRoot ".env"
$appPort = 8080

if (Test-Path $envFile) {
    $portLine = Get-Content $envFile | Where-Object { $_ -match '^APP_PORT=' } | Select-Object -First 1
    if ($portLine) {
        $configuredPort = ($portLine -split '=', 2)[1].Trim()
        if ($configuredPort -match '^\d+$') {
            $appPort = [int]$configuredPort
        }
    }
}

$healthUrl = "http://localhost:$appPort/readyz"
$totalSteps = if ($SkipBuild) { 5 } else { 6 }
$currentStep = 0

function Write-Step {
    param([string]$Message)

    $script:currentStep++
    Write-Host "[$currentStep/$totalSteps] $Message" -ForegroundColor Cyan
}

function Invoke-Compose {
    param([Parameter(Mandatory = $true)][string[]]$ComposeArgs)

    & docker compose -f $composeFile @ComposeArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose 命令执行失败：docker compose -f compose.yml $($ComposeArgs -join ' ')"
    }
}

Push-Location $projectRoot
try {
    Write-Step "检查 Docker Desktop..."
    & docker info *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "无法连接 Docker。请先启动 Docker Desktop，并确认当前终端有权访问 Docker 引擎。"
    }

    Write-Step "校验本地 Compose 配置..."
    Invoke-Compose -ComposeArgs @("config", "--quiet")

    Write-Step "启动 PostgreSQL 与 Redis..."
    Invoke-Compose -ComposeArgs @("up", "-d", "postgres", "redis")

    if (-not $SkipBuild) {
        Write-Step "构建当前工程镜像..."
        Invoke-Compose -ComposeArgs @("--progress", "plain", "build", "api", "worker", "web", "gateway")
    }

    Write-Step "执行数据库迁移..."
    Invoke-Compose -ComposeArgs @("run", "--rm", "api", "/app/migrate")

    Write-Step "启动 Web、API、Worker 与 Gateway..."
    Invoke-Compose -ComposeArgs @("up", "-d", "web", "api", "worker", "gateway")

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $lastError = $null
    do {
        try {
            $response = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 5
            if ($response.ok -eq $true) {
                Write-Host ""
                Write-Host "本地项目已启动：http://localhost:$appPort" -ForegroundColor Green
                Write-Host "健康检查：PostgreSQL=$($response.postgres)，Redis=$($response.redis)" -ForegroundColor Green
                Invoke-Compose -ComposeArgs @("ps")
                exit 0
            }
        } catch {
            $lastError = $_.Exception.Message
        }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)

    Invoke-Compose -ComposeArgs @("ps")
    throw "服务在 $TimeoutSeconds 秒内未通过健康检查。最后错误：$lastError`n可运行 docker compose -f compose.yml logs --tail 200 查看日志。"
} finally {
    Pop-Location
}
