[CmdletBinding()]
param(
    [string]$RunId = 'pc-full-acceptance-20260729-114336',
    [string]$AdminBaseUrl = 'http://127.0.0.1:3002',
    [string]$BackendBaseUrl = 'http://127.0.0.1:8110',
    [string]$Database = 'nexion_acceptance_20260729_114336',
    [string]$MysqlExe = 'D:\software\MySQL\MySQL Server 8.0\bin\mysql.exe',
    [string]$NpxExe = 'D:\software\nodejs\npx.cmd',
    [string]$EvidenceRoot = 'D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\I\review-H-final3'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Require-Environment([string]$Name) {
    $value = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "$Name is required"
    }
    return $value
}

function Wait-FreshTotpStep {
    $next = ([Math]::Floor([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() / 30000) + 1) * 30000 + 750
    $waitMs = [int]($next - [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
    if ($waitMs -gt 0) {
        Start-Sleep -Milliseconds $waitMs
    }
}

function Get-SinglePortProcess([int]$Port) {
    $pids = @(
        Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique
    )
    if ($pids.Count -ne 1) {
        throw "port $Port must have exactly one owning process, found $($pids.Count)"
    }
    return Get-Process -Id $pids[0] -ErrorAction Stop
}

function Invoke-MySqlReadOnly([string]$Sql) {
    $previous = [Environment]::GetEnvironmentVariable('MYSQL_PWD')
    try {
        [Environment]::SetEnvironmentVariable('MYSQL_PWD', $script:DbPassword)
        $output = & $MysqlExe `
            '--host=127.0.0.1' '--port=3306' '--user=root' `
            '--default-character-set=utf8mb4' '--batch' '--raw' '--skip-column-names' `
            "--database=$Database" '-e' $Sql
        if ($LASTEXITCODE -ne 0) {
            throw "mysql read-only gate failed with exit code $LASTEXITCODE"
        }
        return @($output)
    }
    finally {
        [Environment]::SetEnvironmentVariable('MYSQL_PWD', $previous)
    }
}

function Assert-PriorWave([string]$Name, [int]$Expected) {
    $resultPath = Join-Path $EvidenceRoot "$Name\results.json"
    if (-not (Test-Path -LiteralPath $resultPath)) {
        throw "prior I review result missing: $resultPath"
    }
    $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
    if ([int]$result.stats.expected -ne $Expected -or
        [int]$result.stats.unexpected -ne 0 -or
        [int]$result.stats.skipped -ne 0 -or
        [int]$result.stats.flaky -ne 0) {
        throw "prior I review wave is not GREEN: $Name"
    }
}

function Invoke-ReviewWave(
    [string]$Name,
    [string]$Spec,
    [hashtable]$ExtraEnvironment = @{}
) {
    Wait-FreshTotpStep
    $output = Join-Path $EvidenceRoot $Name
    New-Item -ItemType Directory -Path $output -Force | Out-Null
    $changes = @{
        ADMIN_BASE_URL = $AdminBaseUrl
        NEXION_BACKEND_URL = $BackendBaseUrl
        NEXION_BACKEND_BASE_URL = $BackendBaseUrl
        ADMIN_PERMISSION_FIXTURE = $script:FixturePath
        NEXION_ACCEPTANCE_DB = $Database
        NEXION_ACCEPTANCE_DB_PASSWORD = $script:DbPassword
        ADMIN_E2E_USERNAME = [string]$script:Fixture.accounts.maker.username
        ADMIN_E2E_PASSWORD = [string]$script:Fixture.accounts.maker.password
        ADMIN_E2E_TOTP_SECRET = [string]$script:Fixture.accounts.maker.totpSecret
        PLAYWRIGHT_JSON_OUTPUT_FILE = (Join-Path $output 'results.json')
    }
    foreach ($key in $ExtraEnvironment.Keys) {
        $changes[$key] = $ExtraEnvironment[$key]
    }
    $previous = @{}
    try {
        foreach ($key in $changes.Keys) {
            $previous[$key] = [Environment]::GetEnvironmentVariable($key)
            [Environment]::SetEnvironmentVariable($key, [string]$changes[$key])
        }
        & $NpxExe playwright test $Spec `
            '--project=chromium' '--workers=1' '--trace=on' '--reporter=json' "--output=$output"
        if ($LASTEXITCODE -ne 0) {
            throw "$Name failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        foreach ($key in $changes.Keys) {
            [Environment]::SetEnvironmentVariable($key, $previous[$key])
        }
    }
}

$preflightOnly = [Environment]::GetEnvironmentVariable('I_FINAL3_PREFLIGHT_ONLY') -eq '1'
$continuationMode = [Environment]::GetEnvironmentVariable('I_FINAL3_CONTINUATION')
if ([string]::IsNullOrWhiteSpace($continuationMode)) {
    $continuationMode = 'FULL'
}
if ($continuationMode -notin @('FULL', 'I6_ONLY')) {
    throw "unsupported I review continuation mode: $continuationMode"
}
$i6Only = $continuationMode -eq 'I6_ONLY'
if (-not $preflightOnly) {
    $leaseName = if ($i6Only) {
        'I_FINAL3_I6_CONTINUATION_TOKEN'
    }
    else {
        'I_FINAL3_REVIEW_LEASE_TOKEN'
    }
    $lease = Require-Environment $leaseName
    if ($lease.Length -lt 8 -or $lease -eq '<main-controller-issued-token>') {
        throw "$leaseName is invalid"
    }
}
$script:DbPassword = Require-Environment 'NEXION_ACCEPTANCE_DB_PASSWORD'
$expectedJarHash = Require-Environment 'I_FINAL3_BACKEND_JAR_SHA256'
$expectedPcBuildId = Require-Environment 'I_FINAL3_PC_BUILD_ID'
$expectedFixtureHash = Require-Environment 'I_FINAL3_FIXTURE_SHA256'
$script:FixturePath = "D:\workspace\bug-pic\.restricted\$RunId\A\domain-permission-fixtures\I.json"
if (-not (Test-Path -LiteralPath $script:FixturePath)) {
    throw "I permission fixture missing: $script:FixturePath"
}
$script:Fixture = Get-Content -LiteralPath $script:FixturePath -Raw | ConvertFrom-Json
if (-not $script:Fixture.accounts.maker.totpSecret -or -not $script:Fixture.checker.totpSecret) {
    throw 'I maker/checker MFA fixtures are incomplete'
}
$actualFixtureHash = (Get-FileHash -LiteralPath $script:FixturePath -Algorithm SHA256).Hash
if ($actualFixtureHash -ne $expectedFixtureHash) {
    throw "I fixture hash mismatch: $actualFixtureHash"
}
if ($Database -notmatch '^nexion_acceptance_\d{8}_\d{6}$') {
    throw "refusing unexpected I acceptance database: $Database"
}
foreach ($path in @($MysqlExe, $NpxExe)) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "required executable missing: $path"
    }
}
$pcBuildPath = 'D:\workspace\nexion-ops-console\.next\BUILD_ID'
$diskPcBuildId = (Get-Content -LiteralPath $pcBuildPath -Raw).Trim()
if ($diskPcBuildId -ne $expectedPcBuildId) {
    throw "PC Build ID mismatch: $diskPcBuildId"
}
$pcProcess = Get-SinglePortProcess 3002
if ($pcProcess.StartTime.ToUniversalTime() -lt (Get-Item -LiteralPath $pcBuildPath).LastWriteTimeUtc) {
    throw "PC process $($pcProcess.Id) predates frozen Build ID"
}
$pcManifest = Invoke-WebRequest -UseBasicParsing `
    -Uri "$AdminBaseUrl/_next/static/$expectedPcBuildId/_buildManifest.js" `
    -TimeoutSec 15
if ($pcManifest.StatusCode -ne 200) {
    throw "running PC does not serve frozen Build ID $expectedPcBuildId"
}

Add-Type -AssemblyName System.Net.Http
$healthHandler = [Net.Http.HttpClientHandler]::new()
$healthHandler.UseProxy = $false
$healthClient = [Net.Http.HttpClient]::new($healthHandler)
try {
    $healthClient.Timeout = [TimeSpan]::FromSeconds(15)
    $healthResponse = $healthClient.GetAsync("$BackendBaseUrl/actuator/health").GetAwaiter().GetResult()
    $healthStatus = [int]$healthResponse.StatusCode
    $healthBody = $healthResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()
}
finally {
    $healthClient.Dispose()
}
$healthUp = $healthStatus -eq 200 -and (($healthBody | ConvertFrom-Json).status -eq 'UP')
$healthFailClosed = $healthStatus -eq 401 -and $healthBody -match 'AUTH_REQUIRED'
if (-not $healthUp -and -not $healthFailClosed) {
    throw "backend health gate failed with HTTP $healthStatus"
}
$jar = 'D:\workspace\nexion-backend\target\nexion-backend-0.0.1-SNAPSHOT.jar'
$actualJarHash = (Get-FileHash -LiteralPath $jar -Algorithm SHA256).Hash
if ($actualJarHash -ne $expectedJarHash) {
    throw "backend JAR hash mismatch: $actualJarHash"
}
$backendProcess = Get-SinglePortProcess 8110
if ($backendProcess.StartTime.ToUniversalTime() -lt (Get-Item -LiteralPath $jar).LastWriteTimeUtc) {
    throw "backend process $($backendProcess.Id) predates frozen JAR"
}
$backendCommand = (Get-CimInstance Win32_Process -Filter "ProcessId=$($backendProcess.Id)").CommandLine
if ($backendCommand -notmatch '(?i)--nexion\.admin\.mfa\.temporary-superadmin-bypass=false') {
    throw 'backend process does not explicitly pin temporary superadmin MFA bypass=false'
}
$databaseIdentity = Invoke-MySqlReadOnly 'SELECT DATABASE();' | Select-Object -Last 1
if ($databaseIdentity -ne $Database) {
    throw "database identity mismatch: $databaseIdentity"
}

New-Item -ItemType Directory -Path $EvidenceRoot -Force | Out-Null
$priorPreflightSha256 = ''
$redCleanupSha256 = ''
if ($i6Only) {
    $expectedPriorPreflightSha256 = Require-Environment 'I_FINAL3_PRIOR_PREFLIGHT_SHA256'
    $expectedRedCleanupSha256 = Require-Environment 'I_FINAL3_RED_CLEANUP_SHA256'
    $priorPreflightPath = Join-Path $EvidenceRoot 'preflight-only-summary.json'
    $redCleanupPath = Join-Path $EvidenceRoot 'red-i6-carrier-cleanup.json'
    foreach ($path in @($priorPreflightPath, $redCleanupPath)) {
        if (-not (Test-Path -LiteralPath $path)) {
            throw "I6 continuation proof missing: $path"
        }
    }
    $priorPreflightSha256 = (Get-FileHash -LiteralPath $priorPreflightPath -Algorithm SHA256).Hash
    $redCleanupSha256 = (Get-FileHash -LiteralPath $redCleanupPath -Algorithm SHA256).Hash
    if ($priorPreflightSha256 -ne $expectedPriorPreflightSha256) {
        throw "prior preflight hash mismatch: $priorPreflightSha256"
    }
    if ($redCleanupSha256 -ne $expectedRedCleanupSha256) {
        throw "RED cleanup hash mismatch: $redCleanupSha256"
    }
    Assert-PriorWave 'permission' 4
    Assert-PriorWave 'faults' 1
    Assert-PriorWave 'i1-i5-lifecycle' 1
}
$listEnvironment = @{
    ADMIN_BASE_URL = $AdminBaseUrl
    NEXION_BACKEND_URL = $BackendBaseUrl
    NEXION_BACKEND_BASE_URL = $BackendBaseUrl
    ADMIN_PERMISSION_FIXTURE = $script:FixturePath
    NEXION_ACCEPTANCE_DB = $Database
    NEXION_ACCEPTANCE_DB_PASSWORD = $script:DbPassword
    ADMIN_E2E_USERNAME = [string]$script:Fixture.accounts.maker.username
    ADMIN_E2E_PASSWORD = [string]$script:Fixture.accounts.maker.password
    ADMIN_E2E_TOTP_SECRET = [string]$script:Fixture.accounts.maker.totpSecret
    I_PERMISSION_FIXTURE_GENERATED_AT = [string]$script:Fixture.updatedAt
}
$listPrevious = @{}
try {
    foreach ($key in $listEnvironment.Keys) {
        $listPrevious[$key] = [Environment]::GetEnvironmentVariable($key)
        [Environment]::SetEnvironmentVariable($key, [string]$listEnvironment[$key])
    }
    $listSpecs = if ($i6Only) {
        @(
            'tests/e2e/i6-nonowner-h-draft-cas-20260728.spec.ts',
            'tests/e2e/i6-nonowner-h-lifecycle-20260728.spec.ts'
        )
    }
    else {
        @(
            'tests/e2e/i-domain-permission-matrix-post-fixture-20260729.spec.ts',
            'tests/e2e/i-domain-fault-consolidated-nf0q-20260729.spec.ts',
            'tests/e2e/i-domain-write-lifecycle-nf0q-20260729.spec.ts',
            'tests/e2e/i6-nonowner-h-draft-cas-20260728.spec.ts',
            'tests/e2e/i6-nonowner-h-lifecycle-20260728.spec.ts'
        )
    }
    $listOutput = @(& $NpxExe playwright test @listSpecs '--project=chromium' '--list' 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw "I non-Owner Playwright discovery failed: $($listOutput -join [Environment]::NewLine)"
    }
}
finally {
    foreach ($key in $listEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($key, $listPrevious[$key])
    }
}

if ($preflightOnly) {
    $preflight = [ordered]@{
        status = 'PREFLIGHT_ONLY_PASS'
        continuationMode = $continuationMode
        runId = $RunId
        reviewer = 'H non-Owner'
        targetDomain = 'I'
        pcBuildId = $diskPcBuildId
        pcPid = $pcProcess.Id
        backendJarSha256 = $actualJarHash
        backendPid = $backendProcess.Id
        mfaBypass = $false
        actuatorGate = if ($healthUp) { '200/UP' } else { '401/AUTH_REQUIRED' }
        database = $databaseIdentity
        fixtureSha256 = $actualFixtureHash
        priorPreflightSha256 = $priorPreflightSha256
        redCleanupSha256 = $redCleanupSha256
        discoveredTests = @($listOutput | Where-Object { $_ -match 'Total: \d+ tests? in \d+ files?' }) -join ''
        finishedAt = (Get-Date).ToString('o')
    } | ConvertTo-Json -Depth 4
    $preflightFileName = if ($i6Only) {
        'preflight-i6-only-summary.json'
    }
    else {
        'preflight-only-summary.json'
    }
    $preflightPath = Join-Path $EvidenceRoot $preflightFileName
    [IO.File]::WriteAllText(
        $preflightPath,
        [string]::Concat($preflight, [Environment]::NewLine)
    )
    $preflightSha = (Get-FileHash -LiteralPath $preflightPath -Algorithm SHA256).Hash
    Write-Output "PREFLIGHT_ONLY_PASS $preflightPath SHA256=$preflightSha"
    exit 0
}
if (Test-Path -LiteralPath (Join-Path $EvidenceRoot 'nonowner-summary.json')) {
    throw 'I non-Owner final summary already exists; refusing duplicate write run'
}
$startedAt = Get-Date

if (-not $i6Only) {
    Invoke-ReviewWave 'permission' 'tests/e2e/i-domain-permission-matrix-post-fixture-20260729.spec.ts' @{
        I_PERMISSION_FIXTURE_GENERATED_AT = [string]$script:Fixture.updatedAt
    }
    Invoke-ReviewWave 'faults' 'tests/e2e/i-domain-fault-consolidated-nf0q-20260729.spec.ts' @{
        I_FAULT_EVIDENCE_ROOT = (Join-Path $EvidenceRoot 'faults\business')
    }
    Invoke-ReviewWave 'i1-i5-lifecycle' 'tests/e2e/i-domain-write-lifecycle-nf0q-20260729.spec.ts' @{
        I_WRITE_EVIDENCE_ROOT = (Join-Path $EvidenceRoot 'i1-i5-lifecycle\business')
    }
}
Invoke-ReviewWave 'i6-two-writer-cas' 'tests/e2e/i6-nonowner-h-draft-cas-20260728.spec.ts' @{
    I6_CAS_SAFE_EVIDENCE = (Join-Path $EvidenceRoot 'i6-two-writer-cas\cas-safe.json')
}
Invoke-ReviewWave 'i6-lifecycle' 'tests/e2e/i6-nonowner-h-lifecycle-20260728.spec.ts' @{
    I6_REVIEW_H_EVIDENCE_ROOT = (Join-Path $EvidenceRoot 'i6-lifecycle\business')
}

$summary = [ordered]@{
    runId = $RunId
    reviewer = 'H non-Owner'
    targetDomain = 'I'
    status = 'PASS'
    continuationMode = $continuationMode
    priorPreflightSha256 = $priorPreflightSha256
    redCleanupSha256 = $redCleanupSha256
    pc = $AdminBaseUrl
    pcBuildId = $diskPcBuildId
    pcPid = $pcProcess.Id
    backend = $BackendBaseUrl
    backendJarSha256 = $actualJarHash
    backendPid = $backendProcess.Id
    mfaBypass = $false
    waves = @(
        'permission',
        'faults',
        'i1-i5-lifecycle',
        'i6-two-writer-cas',
        'i6-lifecycle'
    )
    startedAt = $startedAt.ToString('o')
    finishedAt = (Get-Date).ToString('o')
}
$json = $summary | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText(
    (Join-Path $EvidenceRoot 'nonowner-summary.json'),
    [string]::Concat($json, [Environment]::NewLine)
)
