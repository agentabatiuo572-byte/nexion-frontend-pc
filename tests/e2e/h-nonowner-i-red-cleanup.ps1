[CmdletBinding()]
param(
    [string]$RunId = 'pc-full-acceptance-20260729-114336',
    [string]$Database = 'nexion_acceptance_20260729_114336',
    [string]$MysqlExe = 'D:\software\MySQL\MySQL Server 8.0\bin\mysql.exe',
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

function Get-SafeHash([string]$Value) {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').Substring(0, 16)
    }
    finally {
        $sha.Dispose()
    }
}

if ($Database -notmatch '^nexion_acceptance_\d{8}_\d{6}$') {
    throw "refusing unexpected database: $Database"
}
$script:DbPassword = Require-Environment 'NEXION_ACCEPTANCE_DB_PASSWORD'

$writeEvidencePath = Join-Path $EvidenceRoot 'i1-i5-lifecycle\business\i-domain-write-safe.json'
if (-not (Test-Path -LiteralPath $writeEvidencePath)) {
    throw "I1-I5 cleanup evidence missing: $writeEvidencePath"
}
$writeEvidence = Get-Content -LiteralPath $writeEvidencePath -Raw | ConvertFrom-Json
$cleanup = $writeEvidence.mutableFixtureCleanup
$i1ToI5Counts = @(
    @($cleanup.copy),
    @($cleanup.nova),
    @($cleanup.campaignAndNotification),
    @($cleanup.trustDraft),
    @($cleanup.disclosure),
    @($cleanup.idempotency),
    @($cleanup.appUser)
) | ForEach-Object { @($_) } | ForEach-Object { $_ }
if (@($i1ToI5Counts | Where-Object { [int]$_ -ne 0 }).Count -ne 0) {
    throw 'I1-I5 cleanup evidence contains a non-zero mutable count'
}

$prefix = 'acceptance.i6.review_h_r151023_'
$rows = @(
    Invoke-MySql @"
SELECT DISTINCT message_key
  FROM nx_i18n_message_version
 WHERE message_key LIKE '$prefix%'
UNION
SELECT DISTINCT message_key
  FROM nx_i18n_message
 WHERE message_key LIKE '$prefix%'
ORDER BY message_key;
"@
)
foreach ($key in $rows) {
    if ([string]$key -notmatch '^acceptance\.i6\.review_h_r151023_[a-z0-9]+$') {
        throw "I6 cleanup identity verification failed: $key"
    }
}
$before = Invoke-MySql @"
SELECT
  (SELECT COUNT(*) FROM nx_i18n_message WHERE message_key LIKE '$prefix%'),
  (SELECT COUNT(*) FROM nx_i18n_message_version WHERE message_key LIKE '$prefix%'),
  (SELECT COUNT(*) FROM nx_admin_idempotency_record WHERE idempotency_key LIKE 'i6-review-h-%');
"@ | Select-Object -Last 1

Invoke-MySql @"
START TRANSACTION;
DELETE FROM nx_i18n_message_version WHERE message_key LIKE '$prefix%';
DELETE FROM nx_i18n_message WHERE message_key LIKE '$prefix%';
DELETE FROM nx_admin_idempotency_record
 WHERE idempotency_key LIKE 'i6-review-h-%'
    OR scope LIKE 'I6\\_I18N\\_%:acceptance.i6.review\\_h\\_r151023\\_%';
COMMIT;
SELECT
  (SELECT COUNT(*) FROM nx_i18n_message WHERE message_key LIKE '$prefix%'),
  (SELECT COUNT(*) FROM nx_i18n_message_version WHERE message_key LIKE '$prefix%'),
  (SELECT COUNT(*) FROM nx_admin_idempotency_record WHERE idempotency_key LIKE 'i6-review-h-%'),
  (SELECT COUNT(*) FROM nx_content_copy_position WHERE position_key LIKE 'acc.i1.%'),
  (SELECT COUNT(*) FROM nx_content_copy WHERE copy_key LIKE 'acc.i1.copy.%'),
  (SELECT COUNT(*) FROM nx_nova_channel WHERE channel_key LIKE 'acc-i2-%'),
  (SELECT COUNT(*) FROM nx_notification_campaign WHERE name LIKE 'I3 acceptance %'),
  (SELECT COUNT(*) FROM nx_admin_idempotency_record WHERE idempotency_key LIKE 'iwrite-%');
"@ | Select-Object -Last 1 | ForEach-Object {
    if ($_ -ne "0`t0`t0`t0`t0`t0`t0`t0") {
        throw "I-domain mutable cleanup sentinel failed: $_"
    }
}

$report = [ordered]@{
    runId = $RunId
    status = 'PASS'
    productDefect = $false
    cause = 'I6 carrier MFA response wait armed before fresh TOTP boundary wait'
    i1ToI5EvidenceCleanup = 'ALL_ZERO'
    i6Before = $before
    i6FixtureKeyHashes = @($rows | ForEach-Object { Get-SafeHash ([string]$_) })
    mutableAfter = [ordered]@{
        i6Message = 0
        i6Version = 0
        i6Idempotency = 0
        i1Position = 0
        i1Copy = 0
        i2Nova = 0
        i3Campaign = 0
        iWriteIdempotency = 0
    }
    immutableAuditOutboxPreserved = $true
    cleanedAt = (Get-Date).ToString('o')
} | ConvertTo-Json -Depth 5
$reportPath = Join-Path $EvidenceRoot 'red-i6-carrier-cleanup.json'
[IO.File]::WriteAllText($reportPath, [string]::Concat($report, [Environment]::NewLine))

[pscustomobject]@{
    Status = 'PASS'
    Report = $reportPath
    Sha256 = (Get-FileHash -LiteralPath $reportPath -Algorithm SHA256).Hash
} | ConvertTo-Json -Compress
