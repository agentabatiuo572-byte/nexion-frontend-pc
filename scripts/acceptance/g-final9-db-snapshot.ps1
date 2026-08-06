param(
    [Parameter(Mandatory = $true)]
    [string]$Database,
    [Parameter(Mandatory = $true)]
    [string]$EvidencePath,
    [string]$RunIdPrefix = 'pc-full-acceptance-20260729-114336'
)

$ErrorActionPreference = 'Stop'
$mysql = 'D:\software\MySQL\MySQL Server 8.0\bin\mysql.exe'
$allowedDatabases = @(
    'nexion_acceptance_20260729_114336',
    'nexion_acceptance_20260729_114336_g_final9'
)
$financialTables = @(
    'nx_exchange_fee_allocation',
    'nx_exchange_order',
    'nx_learning_reward_ledger',
    'nx_nex_buyback_burn_pool_ledger',
    'nx_points_ledger',
    'nx_topup_fee_buffer_ledger',
    'nx_treasury_reserve_ledger',
    'nx_user_wallet',
    'nx_wallet_asset_adjustment',
    'nx_wallet_bill',
    'nx_wallet_ledger'
)

if ($Database -notin $allowedDatabases) {
    throw "G Final9 snapshot refuses database: $Database"
}
if (-not (Test-Path -LiteralPath $mysql)) {
    throw "MySQL client is missing: $mysql"
}
$mysqlPassword = $env:NEXION_ACCEPTANCE_MYSQL_PASSWORD
if (-not $mysqlPassword) {
    throw 'NEXION_ACCEPTANCE_MYSQL_PASSWORD is required and is not persisted'
}

function Invoke-Lines([string]$Sql) {
    $previous = $env:MYSQL_PWD
    try {
        $env:MYSQL_PWD = $mysqlPassword
        $lines = @(& $mysql --host=127.0.0.1 --user=root "--database=$Database" --batch --raw --skip-column-names "--execute=$Sql")
        if ($LASTEXITCODE -ne 0) {
            throw "MySQL read failed with exit code $LASTEXITCODE"
        }
        return @($lines | Where-Object { $_ -ne $null -and $_.Trim().Length -gt 0 })
    } finally {
        $env:MYSQL_PWD = $previous
    }
}

function Invoke-JsonRows([string]$Sql) {
    return @(Invoke-Lines $Sql | ForEach-Object { $_ | ConvertFrom-Json })
}

function Get-TableChecksum([string]$Table) {
    $exists = [int](@(Invoke-Lines "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$Database' AND TABLE_NAME='$Table';")[0])
    if ($exists -eq 0) {
        return [ordered]@{ table = $Table; exists = $false; rows = $null; checksum = $null }
    }
    $rowCount = [long](@(Invoke-Lines "SELECT COUNT(*) FROM ``$Table``;")[0])
    $checksumLine = @(Invoke-Lines "CHECKSUM TABLE ``$Table``;")[0] -split "`t"
    return [ordered]@{
        table = $Table
        exists = $true
        rows = $rowCount
        checksum = if ($checksumLine.Count -ge 2) { $checksumLine[-1] } else { $null }
    }
}

$escapedPrefix = $RunIdPrefix.Replace("'", "''")
$snapshot = [ordered]@{
    capturedAt = [DateTimeOffset]::Now.ToString('o')
    database = $Database
    runIdPrefix = $RunIdPrefix
    core = [ordered]@{
        configItems = Invoke-JsonRows @"
SELECT JSON_OBJECT(
  'configKey', config_key,
  'configValue', config_value,
  'valueType', value_type,
  'status', status,
  'isDeleted', is_deleted
)
FROM nx_config_item
WHERE config_key IN ('G.staking.min.usdt30d','wallet.exchange.fee_pct','wallet.nex_market.weekly_curve')
ORDER BY config_key;
"@
        repurchaseProducts = Invoke-JsonRows @"
SELECT JSON_OBJECT(
  'productCode', product_code,
  'termDays', term_days,
  'apyBps', apy_bps,
  'earlyPenaltyBps', early_penalty_bps,
  'minAmount', min_amount,
  'rewardMultiplier', reward_multiplier,
  'ticketPerOrder', ticket_per_order,
  'presetAmounts', preset_amounts,
  'status', status,
  'isDeleted', is_deleted
)
FROM nx_staking_product
WHERE product_code LIKE 'REPURCHASE%'
ORDER BY product_code;
"@
        genesisPolicies = Invoke-JsonRows @"
SELECT JSON_OBJECT(
  'seriesCode', series_code,
  'priceUsdt', price_usdt,
  'royaltyBps', royalty_bps,
  'dailyDividendRatePct', daily_dividend_rate_pct,
  'status', status,
  'isDeleted', is_deleted
)
FROM nx_genesis_series
WHERE is_deleted=0
ORDER BY series_code;
"@
    }
    financialTableChecksums = @($financialTables | ForEach-Object { Get-TableChecksum $_ })
    runFootprint = [ordered]@{
        idempotency = Invoke-JsonRows @"
SELECT JSON_OBJECT(
  'scope', scope,
  'key', idempotency_key,
  'status', status,
  'isDeleted', is_deleted
)
FROM nx_admin_idempotency_record
WHERE idempotency_key LIKE '$escapedPrefix%'
ORDER BY id DESC
LIMIT 200;
"@
        audit = Invoke-JsonRows @"
SELECT JSON_OBJECT(
  'id', id,
  'action', action,
  'resourceType', resource_type,
  'resourceId', resource_id,
  'actorUsername', actor_username,
  'result', result,
  'detail', detail_json
)
FROM nx_audit_log
WHERE is_deleted=0
  AND CAST(detail_json AS CHAR) LIKE CONCAT('%','$escapedPrefix','%')
ORDER BY id DESC
LIMIT 200;
"@
        outbox = Invoke-JsonRows @"
SELECT JSON_OBJECT(
  'id', id,
  'aggregateType', aggregate_type,
  'aggregateId', aggregate_id,
  'eventType', event_type,
  'eventName', event_name,
  'status', status,
  'serverAuthoritative', is_server_authoritative,
  'payload', payload
)
FROM nx_event_outbox
WHERE is_deleted=0
  AND CAST(payload AS CHAR) LIKE CONCAT('%','$escapedPrefix','%')
ORDER BY id DESC
LIMIT 200;
"@
    }
}

$directory = Split-Path -Parent $EvidencePath
if ($directory) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
}
$json = $snapshot | ConvertTo-Json -Depth 15
[IO.File]::WriteAllText($EvidencePath, $json, [Text.UTF8Encoding]::new($false))
$snapshot | ConvertTo-Json -Depth 15
