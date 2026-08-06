[CmdletBinding()]
param(
    [string]$RunId = 'pc-full-acceptance-20260729-114336',
    [string]$Database = 'nexion_acceptance_20260729_114336_irreversible',
    [string]$MysqlExe = 'D:\software\MySQL\MySQL Server 8.0\bin\mysql.exe',
    [string]$EvidenceRoot = 'D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\H\final3-owner'
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

function Escape-Sql([string]$Value) {
    return $Value.Replace('\', '\\').Replace("'", "''")
}

function Invoke-MySql([string]$Sql) {
    $previous = [Environment]::GetEnvironmentVariable('MYSQL_PWD')
    try {
        [Environment]::SetEnvironmentVariable('MYSQL_PWD', $script:DbPassword)
        $output = & $MysqlExe `
            '--host=127.0.0.1' '--port=3306' '--user=root' `
            '--default-character-set=utf8mb4' '--batch' '--raw' '--skip-column-names' `
            "--database=$Database" '-e' $Sql
        if ($LASTEXITCODE -ne 0) {
            throw "mysql failed with exit code $LASTEXITCODE"
        }
        return @($output)
    }
    finally {
        [Environment]::SetEnvironmentVariable('MYSQL_PWD', $previous)
    }
}

if ($Database -notmatch '^nexion_acceptance_\d{8}_\d{6}_irreversible$') {
    throw "refusing non-isolated database: $Database"
}
if (-not (Test-Path -LiteralPath $MysqlExe)) {
    throw "mysql executable missing: $MysqlExe"
}
$script:DbPassword = Require-Environment 'NEXION_ACCEPTANCE_DB_PASSWORD'

$runtimePath = Join-Path $EvidenceRoot 'h3-cas\business\cas-runtime.json'
if (-not (Test-Path -LiteralPath $runtimePath)) {
    throw "H3 CAS runtime evidence missing: $runtimePath"
}
$runtime = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json
$winnerKey = [string]$runtime.cas.winnerKey
$loserKey = [string]$runtime.cas.loserKey
$unknownKey = [string]$runtime.resultUnknown.key
$keys = @($winnerKey, $loserKey, $unknownKey)
if (($keys | Select-Object -Unique).Count -ne 3) {
    throw 'H3 reconcile requires three distinct idempotency keys'
}
$expectedPrefix = "$RunId-H3-"
foreach ($key in $keys) {
    if (-not $key.StartsWith($expectedPrefix, [StringComparison]::Ordinal)) {
        throw "H3 reconcile key is outside the locked Run ID: $key"
    }
}

$winner = Escape-Sql $winnerKey
$loser = Escape-Sql $loserKey
$unknown = Escape-Sql $unknownKey
$scope = 'GROWTH:H3:QUEST_CONFIG_UPDATE:PROMOBANNER.COUNTDOWNDAYS'
$scopeSql = Escape-Sql $scope
$row = Invoke-MySql @"
SELECT
  (SELECT COUNT(*) FROM nx_admin_idempotency_record
    WHERE is_deleted=0 AND scope='$scopeSql'
      AND idempotency_key='$winner' AND status='SUCCEEDED'),
  (SELECT COUNT(*) FROM nx_admin_idempotency_record
    WHERE is_deleted=0 AND scope='$scopeSql'
      AND idempotency_key='$loser' AND status='SUCCEEDED'
      AND CAST(response_json AS CHAR) LIKE '%QUEST_CONFIG_STALE%'),
  (SELECT COUNT(*) FROM nx_audit_log
    WHERE is_deleted=0 AND CAST(detail_json AS CHAR) LIKE '%$winner%'),
  (SELECT COUNT(*) FROM nx_event_outbox
    WHERE is_deleted=0 AND CAST(payload AS CHAR) LIKE '%$winner%'),
  (SELECT COUNT(*) FROM nx_audit_log
    WHERE is_deleted=0 AND CAST(detail_json AS CHAR) LIKE '%$loser%'),
  (SELECT COUNT(*) FROM nx_event_outbox
    WHERE is_deleted=0 AND CAST(payload AS CHAR) LIKE '%$loser%'),
  (SELECT COUNT(*) FROM nx_admin_idempotency_record
    WHERE is_deleted=0 AND scope='$scopeSql'
      AND idempotency_key='$unknown' AND status='SUCCEEDED'),
  (SELECT COUNT(*) FROM nx_audit_log
    WHERE is_deleted=0 AND CAST(detail_json AS CHAR) LIKE '%$unknown%'),
  (SELECT COUNT(*) FROM nx_event_outbox
    WHERE is_deleted=0 AND CAST(payload AS CHAR) LIKE '%$unknown%');
"@ | Select-Object -Last 1

$expected = "1`t1`t1`t1`t0`t0`t1`t1`t1"
if ($row -ne $expected) {
    throw "H3 reconcile read-only proof failed: $row"
}
$proof = [ordered]@{
    runId = $RunId
    status = 'PASS'
    idempotencyStatusContract = 'SUCCEEDED'
    winner = [ordered]@{ key = $winnerKey; idempotency = 1; audit = 1; outbox = 1 }
    loser = [ordered]@{ key = $loserKey; staleIdempotency = 1; audit = 0; outbox = 0 }
    resultUnknownReplay = [ordered]@{ key = $unknownKey; idempotency = 1; audit = 1; outbox = 1 }
    verifiedAt = (Get-Date).ToString('o')
} | ConvertTo-Json -Depth 4
$proofPath = Join-Path $EvidenceRoot 'h3-cas\database-proof.json'
[IO.File]::WriteAllText($proofPath, [string]::Concat($proof, [Environment]::NewLine))

$idRows = @(Invoke-MySql @"
SELECT id,scope,idempotency_key,status,is_deleted
  FROM nx_admin_idempotency_record
 WHERE is_deleted=0
   AND scope='$scopeSql'
   AND idempotency_key IN ('$winner','$loser','$unknown')
 ORDER BY id;
"@)
if ($idRows.Count -ne 3) {
    throw "H3 reconcile cleanup identity expected 3 rows, found $($idRows.Count)"
}
$ids = @()
foreach ($idRow in $idRows) {
    $parts = [string]$idRow -split "`t", 5
    if ($parts.Count -ne 5 -or
        [long]$parts[0] -le 0 -or
        $parts[1] -ne $scope -or
        $parts[2] -notin $keys -or
        $parts[3] -ne 'SUCCEEDED' -or
        $parts[4] -ne '0') {
        throw 'H3 reconcile cleanup identity verification failed'
    }
    $ids += [long]$parts[0]
}
$idList = $ids -join ','
$cleanupRow = Invoke-MySql @"
START TRANSACTION;
UPDATE nx_admin_idempotency_record
   SET is_deleted=1,updated_at=NOW()
 WHERE id IN ($idList)
   AND is_deleted=0
   AND scope='$scopeSql'
   AND idempotency_key IN ('$winner','$loser','$unknown');
SELECT ROW_COUNT();
COMMIT;
SELECT
  (SELECT COUNT(*) FROM nx_admin_idempotency_record WHERE id IN ($idList) AND is_deleted=0),
  (SELECT COUNT(*) FROM nx_admin_idempotency_record WHERE id IN ($idList) AND is_deleted=1);
"@
if ($cleanupRow.Count -lt 2 -or
    [string]$cleanupRow[0] -ne '3' -or
    [string]$cleanupRow[-1] -ne "0`t3") {
    throw "H3 reconcile exact cleanup failed: $($cleanupRow -join ' | ')"
}
$cleanup = [ordered]@{
    runId = $RunId
    status = 'PASS'
    deletedRecordIds = $ids
    activeAfter = 0
    softDeletedAfter = 3
    cleanedAt = (Get-Date).ToString('o')
} | ConvertTo-Json -Depth 4
$cleanupPath = Join-Path $EvidenceRoot 'h3-cas\idempotency-cleanup-private.json'
[IO.File]::WriteAllText($cleanupPath, [string]::Concat($cleanup, [Environment]::NewLine))

[pscustomobject]@{
    Status = 'PASS'
    ProofPath = $proofPath
    CleanupPath = $cleanupPath
} | ConvertTo-Json -Compress
