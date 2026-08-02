param(
    [ValidateSet('Validate', 'CloneStart', 'StopDestroy')]
    [string]$Action = 'Validate',
    [string]$EvidenceDir = 'D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\G\final9-owner\disposable'
)

$ErrorActionPreference = 'Stop'

$sourceDatabase = 'nexion_acceptance_20260729_114336'
$targetDatabase = 'nexion_acceptance_20260729_114336_g_final9'
$backendPort = 18130
$pcPort = 3310
$redisPort = 6391
$bucket = 'nexion-acc-20260729-114336-g-final9'
$expectedBuildId = 'WF2Bg3fIWMQRSwSJCTh5E'
$expectedJarSha256 = 'AD3EE7ED47E02C2DCCB842F5E74D44641B26E2032F8329BFEC1CE03223021215'
$runtimeRoot = 'D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\candidate-rebuild-final9\runtime\main'
$jarPath = Join-Path $runtimeRoot 'nexion-backend-AD3EE7ED47E0.jar'
$pcRoot = Join-Path $runtimeRoot 'pc-WF2Bg3fIWMQRSwSJCTh5E'
$mysql = 'D:\software\MySQL\MySQL Server 8.0\bin\mysql.exe'
$mysqldump = 'D:\software\MySQL\MySQL Server 8.0\bin\mysqldump.exe'
$redisServer = 'D:\software\Redis-8.6.1\redis-server.exe'
$redisCli = 'D:\software\Redis-8.6.1\redis-cli.exe'
$mc = 'D:\software\MinIO\bin\mc.exe'
$node = 'D:\software\nodejs\node.exe'
$java = 'D:\software\Java\jdk-17\bin\java.exe'
$nextCli = Join-Path $pcRoot 'node_modules\next\dist\bin\next'
$resourceManifest = Join-Path $EvidenceDir 'child-resources.json'

function Assert-ExactTarget {
    if ($targetDatabase -notmatch '^nexion_acceptance_[0-9_]+_g_final9$' -or $targetDatabase -eq $sourceDatabase) {
        throw "Unsafe target database: $targetDatabase"
    }
    if ($bucket -ne 'nexion-acc-20260729-114336-g-final9') {
        throw "Unsafe MinIO bucket: $bucket"
    }
}

function Assert-SecretEnvironment {
    foreach ($name in @(
        'NEXION_ACCEPTANCE_MYSQL_PASSWORD',
        'NEXION_ACCEPTANCE_REDIS_PASSWORD',
        'NEXION_ACCEPTANCE_MINIO_SECRET'
    )) {
        if (-not [Environment]::GetEnvironmentVariable($name)) {
            throw "$name is required and must not be persisted in the script or evidence"
        }
    }
}

function Get-PortFree([int]$Port) {
    $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
    return -not ($listeners.Port -contains $Port)
}

function Wait-Http([string]$Uri, [int[]]$AllowedStatus, [int]$TimeoutSeconds = 120) {
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 5 -SkipHttpErrorCheck
            if ($AllowedStatus -contains [int]$response.StatusCode) {
                return [int]$response.StatusCode
            }
        } catch {
            # The process may still be starting. Retry until the bounded deadline.
        }
        Start-Sleep -Milliseconds 500
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    throw "Timed out waiting for $Uri"
}

function Write-Json([string]$Path, [object]$Value) {
    $json = $Value | ConvertTo-Json -Depth 8
    [IO.File]::WriteAllText($Path, $json, [Text.UTF8Encoding]::new($false))
}

function Invoke-Validation {
    Assert-ExactTarget
    foreach ($path in @($jarPath, $pcRoot, $mysql, $mysqldump, $redisServer, $redisCli, $mc, $node, $java, $nextCli)) {
        if (-not (Test-Path -LiteralPath $path)) {
            throw "Required runtime is missing: $path"
        }
    }
    $jarHash = (Get-FileHash -LiteralPath $jarPath -Algorithm SHA256).Hash
    $buildId = (Get-Content -Raw -LiteralPath (Join-Path $pcRoot '.next\BUILD_ID')).Trim()
    if ($jarHash -ne $expectedJarSha256) {
        throw "Final9 JAR hash mismatch: $jarHash"
    }
    if ($buildId -ne $expectedBuildId) {
        throw "Final9 PC Build ID mismatch: $buildId"
    }
    $ports = @($backendPort, $pcPort, $redisPort) | ForEach-Object {
        [ordered]@{ port = $_; free = Get-PortFree $_ }
    }
    return [ordered]@{
        validatedAt = [DateTimeOffset]::Now.ToString('o')
        sourceDatabase = $sourceDatabase
        targetDatabase = $targetDatabase
        redis = "127.0.0.1:$redisPort/0"
        minioBucket = $bucket
        backendPort = $backendPort
        pcPort = $pcPort
        pcBuildId = $buildId
        jarSha256 = $jarHash
        ports = $ports
    }
}

function Invoke-CloneStart {
    if ($env:G_DISPOSABLE_CLONE -ne '1') {
        throw 'G_DISPOSABLE_CLONE=1 is required from the root controller'
    }
    Assert-SecretEnvironment
    $validation = Invoke-Validation
    if (($validation.ports | Where-Object { -not $_.free }).Count -gt 0) {
        throw 'One or more G Final9 disposable ports are already occupied'
    }
    New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null
    $redisDir = Join-Path $EvidenceDir 'redis-runtime'
    $mcConfig = Join-Path $EvidenceDir 'minio-client-config'
    New-Item -ItemType Directory -Force -Path $redisDir, $mcConfig | Out-Null

    $mysqlPassword = $env:NEXION_ACCEPTANCE_MYSQL_PASSWORD
    & $mysql --host=127.0.0.1 --user=root "--password=$mysqlPassword" --execute="DROP DATABASE IF EXISTS ``$targetDatabase``; CREATE DATABASE ``$targetDatabase`` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
    if ($LASTEXITCODE -ne 0) { throw 'Failed to create exact G Final9 target database' }
    & $mysqldump --host=127.0.0.1 --user=root "--password=$mysqlPassword" --single-transaction --routines --triggers --events --no-tablespaces --set-gtid-purged=OFF $sourceDatabase |
        & $mysql --host=127.0.0.1 --user=root "--password=$mysqlPassword" $targetDatabase
    if ($LASTEXITCODE -ne 0) { throw 'Single-transaction clone into G Final9 target database failed' }

    $redisPassword = $env:NEXION_ACCEPTANCE_REDIS_PASSWORD
    $redisArgs = @(
        '--port', "$redisPort", '--bind', '127.0.0.1', '--protected-mode', 'yes',
        '--requirepass', $redisPassword, '--save', '', '--appendonly', 'no',
        '--dir', $redisDir, '--pidfile', (Join-Path $redisDir 'redis.pid'),
        '--logfile', (Join-Path $redisDir 'redis.log')
    )
    $redisProcess = Start-Process -FilePath $redisServer -ArgumentList $redisArgs -PassThru -WindowStyle Hidden
    $redisReady = $false
    for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
        & $redisCli -h 127.0.0.1 -p $redisPort -a $redisPassword --no-auth-warning PING *> $null
        if ($LASTEXITCODE -eq 0) { $redisReady = $true; break }
        Start-Sleep -Milliseconds 250
    }
    if (-not $redisReady) { throw 'G Final9 isolated Redis did not become ready' }

    $minioSecret = $env:NEXION_ACCEPTANCE_MINIO_SECRET
    & $mc --config-dir $mcConfig alias set g-final9 http://127.0.0.1:9000 minioadmin $minioSecret *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Failed to configure isolated MinIO client alias' }
    & $mc --config-dir $mcConfig mb --ignore-existing "g-final9/$bucket" *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Failed to create exact G Final9 MinIO bucket' }

    $env:SERVER_PORT = "$backendPort"
    $env:NEXION_DB_URL = "jdbc:mysql://127.0.0.1:3306/$targetDatabase?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&useSSL=false&allowPublicKeyRetrieval=true"
    $env:NEXION_DB_USERNAME = 'root'
    $env:NEXION_DB_PASSWORD = $mysqlPassword
    $env:NEXION_REDIS_HOST = '127.0.0.1'
    $env:NEXION_REDIS_PORT = "$redisPort"
    $env:NEXION_REDIS_PASSWORD = $redisPassword
    $env:SPRING_DATA_REDIS_DATABASE = '0'
    $env:NEXION_MINIO_ENDPOINT = 'http://127.0.0.1:9000'
    $env:NEXION_MINIO_ACCESS_KEY = 'minioadmin'
    $env:NEXION_MINIO_SECRET_KEY = $minioSecret
    $env:NEXION_MINIO_BUCKET = $bucket
    $env:NEXION_ADMIN_MFA_TEMPORARY_SUPERADMIN_BYPASS = 'false'
    $env:NEXION_GEO_ALLOW_LOOPBACK_WITHOUT_COUNTRY = 'false'
    $env:NEXION_LOG_FILE = (Join-Path $EvidenceDir 'backend.log')
    $backendProcess = Start-Process -FilePath $java -ArgumentList @('-jar', $jarPath) -WorkingDirectory $EvidenceDir -PassThru -WindowStyle Hidden
    $backendStatus = Wait-Http "http://127.0.0.1:$backendPort/api/admin/auth/session" @(401) 180

    $env:NEXION_BACKEND_URL = "http://127.0.0.1:$backendPort"
    $pcProcess = Start-Process -FilePath $node -ArgumentList @($nextCli, 'start', '-p', "$pcPort") -WorkingDirectory $pcRoot -PassThru -WindowStyle Hidden
    $pcStatus = Wait-Http "http://127.0.0.1:$pcPort/_next/static/$expectedBuildId/_buildManifest.js" @(200) 120

    $resources = [ordered]@{
        runId = 'pc-full-acceptance-20260729-114336-G-Final9'
        createdAt = [DateTimeOffset]::Now.ToString('o')
        sourceDatabase = $sourceDatabase
        database = $targetDatabase
        redisPort = $redisPort
        redisDatabase = 0
        minioBucket = $bucket
        backendPid = $backendProcess.Id
        backendPort = $backendPort
        backendStatus = $backendStatus
        jarSha256 = $expectedJarSha256
        pcPid = $pcProcess.Id
        pcPort = $pcPort
        pcStatus = $pcStatus
        pcBuildId = $expectedBuildId
        redisPid = $redisProcess.Id
        mfaBypass = $false
        cleanupRequired = $true
    }
    Write-Json $resourceManifest $resources
    return $resources
}

function Invoke-StopDestroy {
    if ($env:G_DISPOSABLE_DESTROY -ne '1') {
        throw 'G_DISPOSABLE_DESTROY=1 is required from the root controller'
    }
    Assert-ExactTarget
    Assert-SecretEnvironment
    if (-not (Test-Path -LiteralPath $resourceManifest)) {
        throw "Resource manifest is missing: $resourceManifest"
    }
    $resources = Get-Content -Raw -LiteralPath $resourceManifest | ConvertFrom-Json
    if ($resources.database -ne $targetDatabase -or $resources.minioBucket -ne $bucket) {
        throw 'Resource manifest does not match the exact G Final9 disposable targets'
    }
    foreach ($processId in @($resources.pcPid, $resources.backendPid, $resources.redisPid)) {
        if ($processId) {
            Stop-Process -Id ([int]$processId) -Force -ErrorAction SilentlyContinue
        }
    }

    $mcConfig = Join-Path $EvidenceDir 'minio-client-config'
    $minioSecret = $env:NEXION_ACCEPTANCE_MINIO_SECRET
    & $mc --config-dir $mcConfig alias set g-final9 http://127.0.0.1:9000 minioadmin $minioSecret *> $null
    & $mc --config-dir $mcConfig rm --recursive --force "g-final9/$bucket" *> $null
    & $mc --config-dir $mcConfig rb --force "g-final9/$bucket" *> $null

    $mysqlPassword = $env:NEXION_ACCEPTANCE_MYSQL_PASSWORD
    & $mysql --host=127.0.0.1 --user=root "--password=$mysqlPassword" --execute="DROP DATABASE IF EXISTS ``$targetDatabase``;"
    if ($LASTEXITCODE -ne 0) { throw 'Failed to drop exact G Final9 disposable database' }
    $cleanup = [ordered]@{
        cleanedAt = [DateTimeOffset]::Now.ToString('o')
        stoppedPids = @($resources.pcPid, $resources.backendPid, $resources.redisPid)
        droppedDatabase = $targetDatabase
        removedMinioBucket = $bucket
        evidenceRetained = $EvidenceDir
    }
    Write-Json (Join-Path $EvidenceDir 'cleanup-result.json') $cleanup
    return $cleanup
}

switch ($Action) {
    'Validate' { Invoke-Validation | ConvertTo-Json -Depth 8 }
    'CloneStart' { Invoke-CloneStart | ConvertTo-Json -Depth 8 }
    'StopDestroy' { Invoke-StopDestroy | ConvertTo-Json -Depth 8 }
}
