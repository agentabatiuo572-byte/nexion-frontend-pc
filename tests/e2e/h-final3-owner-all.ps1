[CmdletBinding()]
param(
    [string]$RunId = 'pc-full-acceptance-20260729-114336',
    [string]$AdminBaseUrl = 'http://127.0.0.1:3302',
    [string]$BackendBaseUrl = 'http://127.0.0.1:18110',
    [string]$OtpSinkUrl = 'http://127.0.0.1:18111',
    [string]$OtpSinkFile = '',
    [string]$Database = 'nexion_acceptance_20260729_114336_irreversible',
    [string]$MysqlExe = 'D:\software\MySQL\MySQL Server 8.0\bin\mysql.exe',
    [string]$NodeExe = 'D:\software\nodejs\node.exe',
    [string]$NpxExe = 'D:\software\nodejs\npx.cmd',
    [string]$HFixturePath = 'D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\H\child-final-GSg\fixtures\H-final3-child.json',
    [string]$EvidenceRoot = 'D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\H\final3-owner',
    [decimal]$ReserveSafetyMarginUsd = 0.01
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($RunId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$') {
    throw 'H final3 Run ID is invalid'
}
$restrictedRunRoot = [IO.Path]::GetFullPath("D:\workspace\bug-pic\.restricted\$RunId\")
if (-not [IO.Path]::IsPathRooted($EvidenceRoot)) {
    throw 'EvidenceRoot must be an absolute path'
}
$EvidenceRoot = [IO.Path]::GetFullPath($EvidenceRoot)
if (-not $EvidenceRoot.StartsWith($restrictedRunRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'EvidenceRoot must be beneath the current restricted Run ID'
}

if ([string]::IsNullOrWhiteSpace($OtpSinkFile)) {
    $OtpSinkFile = [Environment]::GetEnvironmentVariable('APP_OTP_SINK_FILE')
}
if ([string]::IsNullOrWhiteSpace($OtpSinkFile)) {
    $OtpSinkFile = "D:\workspace\bug-pic\.restricted\$RunId\F-L\final7-app-dynamic\otp-sink-latest.json"
}
if (-not [IO.Path]::IsPathRooted($OtpSinkFile)) {
    throw 'OTP sink file must be an absolute path'
}
$OtpSinkFile = [IO.Path]::GetFullPath($OtpSinkFile)
if (-not (($OtpSinkFile -split '[\\/]') -contains '.restricted')) {
    throw 'OTP sink file must be beneath a .restricted directory'
}
if (-not $OtpSinkFile.StartsWith($restrictedRunRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'OTP sink file must be beneath the current restricted Run ID'
}
if ([IO.Path]::GetFileName($OtpSinkFile) -cne 'otp-sink-latest.json') {
    throw 'OTP sink file must use the current carrier filename'
}
try {
    $otpSinkUri = [Uri]::new($OtpSinkUrl)
}
catch {
    throw 'OtpSinkUrl must be the frozen loopback carrier'
}
if ($otpSinkUri.Scheme -cne 'http' -or
    $otpSinkUri.Host -cne '127.0.0.1' -or
    $otpSinkUri.Port -ne 18111 -or
    $otpSinkUri.AbsolutePath -cne '/' -or
    $otpSinkUri.Query -ne '' -or
    $otpSinkUri.Fragment -ne '' -or
    $otpSinkUri.UserInfo -ne '') {
    throw 'OtpSinkUrl must be the frozen loopback carrier at http://127.0.0.1:18111'
}

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

function Get-Sha256Hex([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '')
    }
    finally {
        $sha.Dispose()
    }
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

function Invoke-PlaywrightWave(
    [string]$Name,
    [string]$Spec,
    [hashtable]$WaveEnvironment = @{}
) {
    # Admin MFA rejects a code already consumed by a preceding Playwright process.
    # Cross the next TOTP boundary before every isolated wave.
    $nextTotpAt = ([Math]::Floor([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() / 30000) + 1) * 30000 + 750
    $waitMs = [int]($nextTotpAt - [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
    if ($waitMs -gt 0) {
        Start-Sleep -Milliseconds $waitMs
    }
    $output = Join-Path $EvidenceRoot $Name
    New-Item -ItemType Directory -Path $output -Force | Out-Null
    $previous = @{}
    $envChanges = @{
        ADMIN_BASE_URL = $AdminBaseUrl
        NEXION_BACKEND_URL = $BackendBaseUrl
        A_PERMISSION_FIXTURE = $script:HFixturePath
        H_PERMISSION_FIXTURE_PATH = $script:HFixturePath
        H_CHECKER_FIXTURE_PATH = $script:HFixturePath
        H_PERMISSION_RUN_ID = $RunId
        PLAYWRIGHT_JSON_OUTPUT_FILE = (Join-Path $output 'results.json')
    }
    foreach ($key in $WaveEnvironment.Keys) {
        $envChanges[$key] = $WaveEnvironment[$key]
    }
    try {
        foreach ($key in $envChanges.Keys) {
            $previous[$key] = [Environment]::GetEnvironmentVariable($key)
            [Environment]::SetEnvironmentVariable($key, [string]$envChanges[$key])
        }
        & $NpxExe playwright test $Spec `
            '--project=chromium' '--workers=1' '--trace=on' '--reporter=json' "--output=$output"
        if ($LASTEXITCODE -ne 0) {
            throw "$Name failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        foreach ($key in $envChanges.Keys) {
            [Environment]::SetEnvironmentVariable($key, $previous[$key])
        }
    }
}

function Assert-Port([int]$Port) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    if (-not $listener) {
        throw "required port $Port is not listening"
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

function Enter-B1CoverageLock {
    $lockRoot = Join-Path 'D:\workspace\bug-pic\.restricted' 'coordination\locks'
    New-Item -ItemType Directory -Path $lockRoot -Force | Out-Null
    $script:B1CoverageLockPath = Join-Path $lockRoot 'B1_COVERAGE_SINGLETON.lck'
    $script:B1CoverageLockOwned = $false
    try {
        $script:B1CoverageLockStream = [IO.File]::Open(
            $script:B1CoverageLockPath,
            [IO.FileMode]::CreateNew,
            [IO.FileAccess]::Write,
            [IO.FileShare]::None
        )
        $script:B1CoverageLockOwned = $true
        $script:B1CoverageLockWasOwned = $true
        $payload = [Text.Encoding]::UTF8.GetBytes("$RunId|H8|$PID|$([DateTimeOffset]::UtcNow.ToString('o'))")
        $script:B1CoverageLockStream.Write($payload, 0, $payload.Length)
        $script:B1CoverageLockStream.Flush($true)
    }
    catch {
        throw "global B1 coverage lock is already held: $($script:B1CoverageLockPath)"
    }
}

function Exit-B1CoverageLock {
    if (-not $script:B1CoverageLockOwned) {
        return
    }
    if ($null -ne $script:B1CoverageLockStream) {
        $script:B1CoverageLockStream.Dispose()
        $script:B1CoverageLockStream = $null
    }
    if (-not [string]::IsNullOrWhiteSpace($script:B1CoverageLockPath) -and
        (Test-Path -LiteralPath $script:B1CoverageLockPath)) {
        Remove-Item -LiteralPath $script:B1CoverageLockPath -Force
    }
    $script:B1CoverageLockOwned = $false
}

function Get-B1Snapshot {
    $row = Invoke-MySql @"
SET @reserve_ledger=(SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN amount_usd ELSE -amount_usd END),0)
  FROM nx_treasury_reserve_ledger WHERE is_deleted=0 AND status='CONFIRMED');
SET @vietqr_reserve=(SELECT COALESCE(SUM(received_vnd/NULLIF(locked_fx_rate_vnd_per_usdt,0)),0)
  FROM nx_vietqr_reconciliation WHERE is_deleted=0 AND received_vnd>0
   AND status IN ('OPEN','CREDITED','RETURN_PENDING'));
SET @staking_principal=(SELECT COALESCE(SUM(amount_usdt),0) FROM nx_staking_position
  WHERE is_deleted=0 AND status IN ('ACTIVE','LOCKED'));
SET @reserve_base=@reserve_ledger+@vietqr_reserve-@staking_principal;
SET @reserve=GREATEST(@reserve_base,0);
SET @nex_rate=COALESCE((SELECT price_usdt FROM nx_price_index WHERE is_deleted=0 AND status='ACTIVE'
  AND metric_code IN ('NEX','NEX_USDT') ORDER BY sampled_at DESC,id DESC LIMIT 1),0);
SET @liabilities=(SELECT COALESCE(SUM(usdt_available),0) FROM nx_user_wallet WHERE is_deleted=0)
  + @staking_principal
  + (SELECT COALESCE(SUM(estimated_interest_usdt),0) FROM nx_staking_position WHERE is_deleted=0 AND status IN ('ACTIVE','LOCKED'))
  + (SELECT COALESCE(SUM(h.acquired_price_usdt*s.daily_dividend_rate_pct/100),0)
       FROM nx_genesis_holding h JOIN nx_genesis_series s ON s.series_code=h.series_code AND s.is_deleted=0
      WHERE h.is_deleted=0 AND UPPER(h.status) IN ('ACTIVE','HELD','LISTED'))
  + ((SELECT COALESCE(SUM(amount_nex+estimated_reward_nex),0) FROM nx_nex_lock_order
       WHERE is_deleted=0 AND status IN ('ACTIVE','LOCKED'))*@nex_rate)
  + (SELECT COALESCE(SUM(amount),0) FROM nx_withdrawal_order WHERE is_deleted=0 AND asset='USDT'
       AND status IN ('SUBMITTED','REVIEW_PENDING','EXTENDED_HOLD','REVIEW_PASSED','PROCESSING','SENT','FROZEN','REVIEW_REJECTED','ADDRESS_INVALID','TX_FAILED','TX_ORPHANED','PENDING','REVIEWING','DELAYED','PENDING_CHAIN','CHAIN_SUBMITTED','DEAD'))
  + (SELECT COALESCE(SUM(amount),0) FROM nx_wallet_ledger WHERE is_deleted=0 AND asset='USDT'
       AND direction='IN' AND status='PENDING' AND biz_type IN ('REFERRAL_COMMISSION','COMMISSION','TEAM_COMMISSION'))
  + (SELECT COALESCE(SUM(principal_usdt+accrued_interest_usdt),0) FROM nx_treasury_legacy_lock_liability
       WHERE is_deleted=0 AND status IN ('ACTIVE','LOCKED'))
  + (SELECT COALESCE(SUM(received_vnd/NULLIF(locked_fx_rate_vnd_per_usdt,0)),0) FROM nx_vietqr_reconciliation
       WHERE is_deleted=0 AND status='OPEN' AND received_vnd>0);
SET @redline=COALESCE((SELECT CAST(config_value AS DECIMAL(30,6)) FROM nx_config_item
  WHERE config_key='wallet.dual-ledger.redline-pct' AND status=1 AND is_deleted=0 LIMIT 1),100);
SELECT CAST(@reserve AS DECIMAL(30,6)),CAST(@reserve_base AS DECIMAL(30,6)),CAST(@liabilities AS DECIMAL(30,6)),CAST(@redline AS DECIMAL(30,6)),
       CAST(CASE WHEN @liabilities=0 THEN CASE WHEN @reserve>0 THEN 99999 ELSE 0 END ELSE @reserve/@liabilities*100 END AS DECIMAL(30,6));
"@ | Select-Object -Last 1
    $parts = @($row -split "`t")
    if ($parts.Count -ne 5) { throw "unexpected B1 snapshot row: $row" }
    return [ordered]@{
        reserveUsd = [decimal]$parts[0]
        reserveBaseUsd = [decimal]$parts[1]
        liabilitiesUsd = [decimal]$parts[2]
        redlinePct = [decimal]$parts[3]
        coverageRatio = [decimal]$parts[4]
    }
}

function Get-H8TargetNewcomerUsdt {
    $row = Invoke-MySql @"
SET @month=CAST((SELECT config_value FROM nx_config_item WHERE config_key='H1.rhythm.currentMonth' AND status=1 AND is_deleted=0 LIMIT 1) AS UNSIGNED);
SET @base=CAST((SELECT config_value FROM nx_config_item WHERE config_key='K.rewards.welcomeGift.usdtAmount' AND status=1 AND is_deleted=0 LIMIT 1) AS DECIMAL(30,6));
SET @multiplier=CAST((SELECT config_value FROM nx_config_item WHERE config_key=CONCAT('growth.phase.month.',@month,'.newUserBonusMultiplier') AND status=1 AND is_deleted=0 LIMIT 1) AS DECIMAL(30,6));
SELECT CAST(@base*@multiplier AS DECIMAL(30,6));
"@ | Select-Object -Last 1
    if ($row -notmatch '^\d+(?:\.\d+)?$') { throw "H8 effective newcomer USDT is unavailable: $row" }
    return [decimal]$row
}

function New-ReserveFixture([string]$WaveId) {
    $suffix = (Get-Sha256Hex ([Text.Encoding]::UTF8.GetBytes($WaveId))).Substring(0, 16)
    $script:ReserveNo = "RSV-ACC-H8-$suffix"
    $script:VoucherNo = "ACC-H8-$suffix"
    $reserveNo = Escape-Sql $script:ReserveNo
    $voucherNo = Escape-Sql $script:VoucherNo
    $pre = Get-B1Snapshot
    $script:B1PreSnapshot = $pre
    $script:ReserveLedgerBeforeUsd = [decimal](Invoke-MySql "SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN amount_usd ELSE -amount_usd END),0) FROM nx_treasury_reserve_ledger WHERE is_deleted=0 AND status='CONFIRMED';" | Select-Object -Last 1)
    $targetNewcomerUsdt = Get-H8TargetNewcomerUsdt
    $requiredReserve = ($pre.liabilitiesUsd + $targetNewcomerUsdt) * $pre.redlinePct / 100
    $shortfall = [decimal]::Max(0, $requiredReserve - $pre.reserveBaseUsd)
    $amountValue = if ($shortfall -gt 0) {
        ([Math]::Ceiling($shortfall * 1000000) / 1000000) + $ReserveSafetyMarginUsd
    } else { [decimal]0 }
    $amount = $amountValue.ToString([Globalization.CultureInfo]::InvariantCulture)
    if ($amountValue -eq 0) {
        $script:ReserveInserted = $false
        $evidence = [ordered]@{
            runId = $RunId; waveId = $WaveId; amountUsd = 0
            reserveBeforeUsd = $pre.reserveUsd; reserveBaseBeforeUsd = $pre.reserveBaseUsd; liabilitiesBeforeUsd = $pre.liabilitiesUsd
            targetNewcomerUsdt = $targetNewcomerUsdt; redlinePct = $pre.redlinePct
            minimumReserveCalculation = $true; directSqlFixture = $false
        } | ConvertTo-Json
        [IO.File]::WriteAllText((Join-Path $EvidenceRoot 'reserve-fixture.json'), [string]::Concat($evidence, [Environment]::NewLine))
        return
    }
    $rows = Invoke-MySql @"
SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN amount_usd ELSE -amount_usd END),0)
  FROM nx_treasury_reserve_ledger
 WHERE is_deleted=0 AND status='CONFIRMED';
INSERT INTO nx_treasury_reserve_ledger(
  reserve_no,voucher_no,direction,amount_usd,reason,operator,idempotency_key,
  status,created_at,updated_at,is_deleted)
VALUES(
  '$reserveNo','$voucherNo','IN',$amount,
  '$($WaveId.Replace("'", "''")) H8 isolated B1 reserve precondition',
  'acceptance-controller','$($WaveId.Replace("'", "''"))-reserve',
  'CONFIRMED',NOW(),NOW(),0);
SELECT ROW_COUNT();
SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN amount_usd ELSE -amount_usd END),0)
  FROM nx_treasury_reserve_ledger
 WHERE is_deleted=0 AND status='CONFIRMED';
"@
    if ($rows.Count -lt 3 -or [int]$rows[1] -ne 1) {
        throw "reserve fixture insert was not exactly one row"
    }
    $script:ReserveInserted = $true
    $script:ReserveLedgerBeforeUsd = [decimal]$rows[0]
    $evidence = [ordered]@{
        runId = $RunId
        waveId = $WaveId
        reserveNo = $script:ReserveNo
        voucherNo = $script:VoucherNo
        amountUsd = $amountValue
        reserveBeforeUsd = $pre.reserveUsd
        reserveBaseBeforeUsd = $pre.reserveBaseUsd
        liabilitiesBeforeUsd = $pre.liabilitiesUsd
        targetNewcomerUsdt = $targetNewcomerUsdt
        redlinePct = $pre.redlinePct
        reserveLedgerBeforeUsd = $rows[0]
        reserveLedgerAfterUsd = $rows[2]
        minimumReserveCalculation = $true
        safetyMarginUsd = $ReserveSafetyMarginUsd
        directSqlFixture = $true
        auditOutboxWritten = $false
    } | ConvertTo-Json
    [IO.File]::WriteAllText(
        (Join-Path $EvidenceRoot 'reserve-fixture.json'),
        [string]::Concat($evidence, [Environment]::NewLine)
    )
}

function Remove-ReserveFixture {
    if ([string]::IsNullOrWhiteSpace($script:ReserveNo)) {
        return
    }
    $reserveNo = Escape-Sql $script:ReserveNo
    $voucherNo = Escape-Sql $script:VoucherNo
    $markerCount = [int](Invoke-MySql "SELECT COUNT(*) FROM nx_treasury_reserve_ledger WHERE reserve_no='$reserveNo' AND voucher_no='$voucherNo' AND operator='acceptance-controller';" | Select-Object -Last 1)
    if ($markerCount -eq 0) { return }
    if ($markerCount -ne 1) { throw "reserve fixture marker is not unique: $markerCount" }
    $rows = Invoke-MySql @"
DELETE FROM nx_treasury_reserve_ledger
 WHERE reserve_no='$reserveNo' AND voucher_no='$voucherNo'
   AND operator='acceptance-controller';
SELECT ROW_COUNT();
SELECT COUNT(*) FROM nx_treasury_reserve_ledger
 WHERE reserve_no='$reserveNo' OR voucher_no='$voucherNo';
SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN amount_usd ELSE -amount_usd END),0)
  FROM nx_treasury_reserve_ledger
 WHERE is_deleted=0 AND status='CONFIRMED';
"@
    if ($rows.Count -lt 3 -or [int]$rows[0] -ne 1 -or [int]$rows[1] -ne 0 -or
        [decimal]$rows[2] -ne $script:ReserveLedgerBeforeUsd) {
        throw "reserve fixture cleanup did not remove exactly one isolated row"
    }
}

function Get-NonTargetFingerprint([long]$InvitedUserId, [long]$InviterUserId) {
    $rows = @(Invoke-MySql @"
SELECT section_name,row_key,row_value
FROM (
 SELECT 'settlement' AS section_name,LPAD(id,20,'0') AS row_key,
        CONCAT_WS('|',id,HEX(settlement_no),invited_user_id,inviter_user_id,newcomer_usdt,newcomer_nex,
          inviter_nex,HEX(lock_mode),HEX(config_snapshot),HEX(operator),HEX(reason),HEX(idempotency_key),
          HEX(status),DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%f'),DATE_FORMAT(updated_at,'%Y-%m-%dT%H:%i:%s.%f'),is_deleted) AS row_value
   FROM nx_referral_reward_settlement
  WHERE NOT (invited_user_id=$InvitedUserId AND inviter_user_id=$InviterUserId)
 UNION ALL
 SELECT 'wallet',LPAD(id,20,'0'),
        CONCAT_WS('|',id,user_id,usdt_available,nex_available,pending_withdraw,lifetime_earned,cumulative_deposit_usdt,
          version,DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%f'),DATE_FORMAT(updated_at,'%Y-%m-%dT%H:%i:%s.%f'),is_deleted)
   FROM nx_user_wallet WHERE user_id NOT IN ($InvitedUserId,$InviterUserId)
 UNION ALL
 SELECT 'ledger',LPAD(id,20,'0'),
        CONCAT_WS('|',id,user_id,HEX(biz_no),HEX(biz_type),HEX(asset),HEX(direction),amount,balance_after,
          HEX(status),HEX(COALESCE(remark,'')),DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%f'),
          DATE_FORMAT(updated_at,'%Y-%m-%dT%H:%i:%s.%f'),is_deleted)
   FROM nx_wallet_ledger WHERE user_id NOT IN ($InvitedUserId,$InviterUserId)
) canonical
ORDER BY section_name,row_key;
"@)
    $canonical = [string]::Join("`n", $rows)
    return Get-Sha256Hex ([Text.Encoding]::UTF8.GetBytes($canonical))
}

function New-H8TargetOrderProof([string]$WaveId, [string]$AppManifestPath, [string]$PrivateManifestPath) {
    $script:H8WaveId = $WaveId
    $manifest = Get-Content -LiteralPath $AppManifestPath -Raw | ConvertFrom-Json
    $private = Get-Content -LiteralPath $PrivateManifestPath -Raw | ConvertFrom-Json
    if ([string]$manifest.runId -cne $WaveId -or [string]$manifest.result -cne 'PASS') {
        throw 'H8 App manifest is not the PASS manifest for this wave'
    }
    $invited = [long]$manifest.accounts.invitee.userId
    $inviter = [long]$manifest.accounts.inviter.userId
    if ($invited -le 0 -or $inviter -le 0 -or $invited -eq $inviter -or
        $invited -ne [long]$private.accounts.invitee.userId -or
        $inviter -ne [long]$private.accounts.inviter.userId) {
        throw 'H8 public/private App manifests do not identify one matching target relation'
    }

    $rows = @(Invoke-MySql @"
SET @effective_raw=(SELECT config_value FROM nx_config_item WHERE config_key='K.rewards.referral.effectiveAt' AND status=1 AND is_deleted=0 LIMIT 1);
SET @effective_at=CAST(REPLACE(SUBSTRING_INDEX(@effective_raw,'Z',1),'T',' ') AS DATETIME(6));
SELECT DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%f') FROM nx_user WHERE id=$invited AND is_deleted=0;
UPDATE nx_user SET created_at=@effective_at WHERE id=$invited AND sponsor_user_id=$inviter AND is_deleted=0 AND status='ACTIVE'
 AND NOT EXISTS (SELECT 1 FROM nx_referral_reward_settlement s WHERE s.invited_user_id=$invited AND s.is_deleted=0);
SELECT ROW_COUNT();
SELECT COUNT(*) FROM nx_user u JOIN nx_user i ON i.id=u.sponsor_user_id AND i.is_deleted=0 AND i.status='ACTIVE'
 LEFT JOIN nx_referral_reward_settlement s ON s.invited_user_id=u.id AND s.is_deleted=0
 WHERE u.id=$invited AND u.sponsor_user_id=$inviter AND u.is_deleted=0 AND u.status='ACTIVE' AND u.sponsor_user_id<>u.id
   AND u.created_at>=@effective_at AND s.id IS NULL;
SELECT COUNT(*) FROM nx_user u JOIN nx_user i ON i.id=u.sponsor_user_id AND i.is_deleted=0 AND i.status='ACTIVE'
 LEFT JOIN nx_referral_reward_settlement s ON s.invited_user_id=u.id AND s.is_deleted=0
 WHERE u.sponsor_user_id IS NOT NULL AND u.is_deleted=0 AND u.status='ACTIVE' AND u.sponsor_user_id<>u.id
   AND u.created_at>=@effective_at AND s.id IS NULL
   AND (u.created_at<(SELECT created_at FROM nx_user WHERE id=$invited)
     OR (u.created_at=(SELECT created_at FROM nx_user WHERE id=$invited) AND u.id<$invited));
SELECT
 (SELECT COUNT(*) FROM nx_admin_risk_arbitrage_row r WHERE r.is_deleted=0 AND CONCAT_WS('|',r.cell1,r.cell2,r.cell3,r.cell4,r.cell5,r.cell6) REGEXP CONCAT('U0*(',CAST($invited AS CHAR),'|',CAST($inviter AS CHAR),')'))
 +(SELECT COUNT(*) FROM nx_admin_risk_multi_account_cluster c WHERE c.is_deleted=0 AND c.nodes_json IS NOT NULL AND JSON_VALID(c.nodes_json)=1
    AND (JSON_SEARCH(c.nodes_json,'one',CONCAT('U',LPAD($invited,GREATEST(8,CHAR_LENGTH(CAST($invited AS CHAR))),'0'))) IS NOT NULL
      OR JSON_SEARCH(c.nodes_json,'one',CONCAT('U',LPAD($inviter,GREATEST(8,CHAR_LENGTH(CAST($inviter AS CHAR))),'0'))) IS NOT NULL));
SELECT DATE_FORMAT(@effective_at,'%Y-%m-%dT%H:%i:%s.%f');
"@)
    if ($rows.Count -ge 2 -and [int]$rows[1] -eq 1) {
        $script:H8TargetUserId = $invited
        $script:H8TargetOriginalCreatedAt = [string]$rows[0]
        $script:H8TargetCreatedAtChanged = $true
    }
    if ($rows.Count -lt 6 -or [int]$rows[1] -ne 1 -or [int]$rows[2] -ne 1 -or
        [int]$rows[3] -ne 0 -or [int]$rows[4] -ne 0) {
        throw "H8 target cannot be proved as the unique first eligible limit-one relation: $($rows -join '|')"
    }
    $fingerprint = Get-NonTargetFingerprint $invited $inviter
    $proofPath = Join-Path (Split-Path -Parent $AppManifestPath) 'target-order-proof.json'
    $proof = [ordered]@{
        runId = $WaveId
        invitedUserId = $invited
        inviterUserId = $inviter
        originalTargetCreatedAt = $rows[0]
        controlledTargetCreatedAt = $rows[5]
        isolatedDatabase = $Database
        targetEligibleCount = 1
        eligibleBeforeTarget = 0
        targetIsFirstEligible = $true
        targetRiskReferenceCount = 0
        nonTargetFingerprintBefore = $fingerprint
        directSettlementMutation = $false
    } | ConvertTo-Json
    [IO.File]::WriteAllText($proofPath, [string]::Concat($proof, [Environment]::NewLine))
    return $proofPath
}

function Restore-H8TargetOrderingFixture {
    if (-not $script:H8TargetCreatedAtChanged -or $script:H8TargetUserId -le 0 -or
        [string]::IsNullOrWhiteSpace($script:H8TargetOriginalCreatedAt)) {
        return
    }
    $original = Escape-Sql $script:H8TargetOriginalCreatedAt
    $row = Invoke-MySql @"
UPDATE nx_user SET created_at=STR_TO_DATE('$original','%Y-%m-%dT%H:%i:%s.%f')
 WHERE id=$($script:H8TargetUserId) AND is_deleted=0;
SELECT ROW_COUNT();
SELECT COUNT(*) FROM nx_user WHERE id=$($script:H8TargetUserId) AND is_deleted=0
 AND created_at=STR_TO_DATE('$original','%Y-%m-%dT%H:%i:%s.%f');
"@
    if ($row.Count -lt 2 -or ([int]$row[0] -notin @(0,1)) -or [int]$row[1] -ne 1) {
        throw "H8 target ordering fixture was not restored exactly: $($row -join '|')"
    }
    $script:H8TargetCreatedAtChanged = $false
}

function Assert-H8TargetOutcome([string]$AppManifestPath, [string]$OrderProofPath) {
    $manifest = Get-Content -LiteralPath $AppManifestPath -Raw | ConvertFrom-Json
    $proof = Get-Content -LiteralPath $OrderProofPath -Raw | ConvertFrom-Json
    $progress = Get-Content -LiteralPath (Join-Path $EvidenceRoot 'h8-settlement\progress.json') -Raw | ConvertFrom-Json
    $invited = [long]$manifest.accounts.invitee.userId
    $inviter = [long]$manifest.accounts.inviter.userId
    $settlementNo = Escape-Sql ([string]$progress.settlementNo)
    $operationId = Escape-Sql ([string]$progress.operationId)
    $row = Invoke-MySql @"
SELECT
 (SELECT COUNT(*) FROM nx_referral_reward_settlement WHERE settlement_no='$settlementNo' AND invited_user_id=$invited AND inviter_user_id=$inviter AND status='SETTLED' AND is_deleted=0),
 (SELECT COUNT(*) FROM nx_user_wallet WHERE user_id IN ($invited,$inviter) AND is_deleted=0),
 (SELECT COUNT(*) FROM nx_user_wallet WHERE user_id=$invited AND usdt_available>0 AND nex_available>0 AND is_deleted=0),
 (SELECT COUNT(*) FROM nx_user_wallet WHERE user_id=$inviter AND nex_available>0 AND is_deleted=0),
 (SELECT COUNT(*) FROM nx_wallet_ledger WHERE user_id IN ($invited,$inviter) AND (biz_no='$settlementNo' OR biz_no LIKE CONCAT('$settlementNo',':%')) AND status='SUCCESS' AND is_deleted=0),
 (SELECT COUNT(*) FROM nx_audit_log WHERE action='REFERRAL_REWARD_SETTLED' AND resource_id='$settlementNo' AND is_deleted=0),
 (SELECT COUNT(*) FROM nx_event_outbox WHERE aggregate_type='REFERRAL_REWARD_SETTLEMENT' AND aggregate_id='$settlementNo' AND event_type='H8_REFERRAL_REWARD_SETTLED' AND is_deleted=0),
 (SELECT COUNT(*) FROM nx_audit_operation_ticket WHERE operation_id='$operationId' AND status='approved' AND is_deleted=0),
 (SELECT COUNT(*) FROM nx_audit_object_lock WHERE ticket_id='$operationId' AND is_deleted=0);
"@ | Select-Object -Last 1
    if ($row -ne "1`t2`t1`t1`t3`t1`t1`t1`t0") {
        throw "H8 target settlement/wallet/D4/A2/A4/outbox proof failed: $row"
    }
    $afterFingerprint = Get-NonTargetFingerprint $invited $inviter
    if ($afterFingerprint -cne [string]$proof.nonTargetFingerprintBefore) {
        throw 'H8 non-target settlement/wallet fingerprint changed during limit-one settlement'
    }
    $post = [ordered]@{
        runId = $proof.runId; operationId = $progress.operationId; settlementNo = $progress.settlementNo
        targetSettlement = 1; targetWallets = 2; targetD4Rows = 3; targetA2Approved = 1
        targetAudit = 1; targetOutbox = 1; activeObjectLocks = 0
        nonTargetFingerprintBefore = $proof.nonTargetFingerprintBefore
        nonTargetFingerprintAfter = $afterFingerprint
        nonTargetUnchanged = $true
    } | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $EvidenceRoot 'h8-settlement\target-post-proof.json'), [string]::Concat($post, [Environment]::NewLine))
}

function Write-B1PostSnapshot {
    $post = Get-B1Snapshot
    if ($post.coverageRatio -lt $post.redlinePct) {
        throw "B1 post-settlement coverage fell below redline: $($post.coverageRatio) < $($post.redlinePct)"
    }
    [IO.File]::WriteAllText(
        (Join-Path $EvidenceRoot 'reserve-post-settlement.json'),
        [string]::Concat(($post | ConvertTo-Json), [Environment]::NewLine)
    )
}

function Assert-B1Restored {
    if ($null -eq $script:B1PreSnapshot) { return }
    $restored = Get-B1Snapshot
    foreach ($field in @('reserveUsd','reserveBaseUsd','liabilitiesUsd','redlinePct','coverageRatio')) {
        if ([decimal]$restored[$field] -ne [decimal]$script:B1PreSnapshot[$field]) {
            throw "B1 $field was not exactly restored: before=$($script:B1PreSnapshot[$field]) after=$($restored[$field])"
        }
    }
    $proof = [ordered]@{
        runId = $RunId
        before = $script:B1PreSnapshot
        restored = $restored
        exactRestore = $true
    } | ConvertTo-Json -Depth 4
    [IO.File]::WriteAllText(
        (Join-Path $EvidenceRoot 'reserve-restored.json'),
        [string]::Concat($proof, [Environment]::NewLine)
    )
}

function Remove-HMutableData {
    $runPrefix = Escape-Sql "$RunId-"
    $upperHPattern = Escape-Sql "$RunId-H-%"
    $lowerHPattern = Escape-Sql "$RunId-h-%"
    $makerCrossWriteKey = Escape-Sql "$RunId-maker-cross-write-probe"
    $identityWhere = @"
is_deleted=0
AND idempotency_key LIKE '$runPrefix%'
AND (
  scope LIKE 'GROWTH:H%'
  OR scope='REFERRAL_REWARD_SETTLEMENT'
  OR (
    scope='A2_COMMAND'
    AND (
      idempotency_key LIKE '$upperHPattern'
      OR idempotency_key LIKE '$lowerHPattern'
      OR idempotency_key='$makerCrossWriteKey'
    )
  )
)
"@
    $rows = @(Invoke-MySql "SELECT id,scope,idempotency_key FROM nx_admin_idempotency_record WHERE $identityWhere ORDER BY id;")
    $records = @($rows | ForEach-Object {
        $parts = [string]$_ -split "`t", 3
        if ($parts.Count -ne 3 -or
            [long]$parts[0] -le 0 -or
            -not $parts[2].StartsWith("$RunId-", [StringComparison]::Ordinal)) {
            throw "H idempotency cleanup identity verification failed"
        }
        [ordered]@{
            id = [long]$parts[0]
            scope = $parts[1]
            idempotencyKey = $parts[2]
        }
    })
    $cleanupManifest = [ordered]@{
        runId = $RunId
        records = $records
    } | ConvertTo-Json -Depth 4
    [IO.File]::WriteAllText(
        (Join-Path $EvidenceRoot 'idempotency-cleanup-private.json'),
        [string]::Concat($cleanupManifest, [Environment]::NewLine)
    )
    if ($records.Count -gt 0) {
        $idList = (@($records | ForEach-Object { [string]$_.id }) -join ',')
        Invoke-MySql @"
START TRANSACTION;
UPDATE nx_admin_idempotency_record
   SET is_deleted=1,updated_at=NOW()
 WHERE id IN ($idList)
   AND $identityWhere;
COMMIT;
SELECT COUNT(*) FROM nx_admin_idempotency_record
 WHERE id IN ($idList) AND is_deleted=0;
"@ | Select-Object -Last 1 | ForEach-Object {
            if ($_ -ne '0') {
                throw "H idempotency exact cleanup sentinel failed: $_"
            }
        }
    }

    $voucherName = ''
    $voucherEvidencePath = Join-Path $EvidenceRoot 'h5-h7\business\H7-result.json'
    if (Test-Path -LiteralPath $voucherEvidencePath) {
        $voucherEvidence = Get-Content -LiteralPath $voucherEvidencePath -Raw | ConvertFrom-Json
        $voucherName = [string]$voucherEvidence.voucherName
        if ($voucherName -notmatch '^H7首次用户验收券-\d{10,20}$') {
            throw 'H7 voucher cleanup evidence identity verification failed'
        }
    }
    if ([string]::IsNullOrWhiteSpace($voucherName)) {
        return
    }
    $voucherName = Escape-Sql $voucherName
    Invoke-MySql @"
START TRANSACTION;
UPDATE nx_growth_voucher
   SET is_deleted=1,updated_at=NOW()
 WHERE is_deleted=0
   AND voucher_name='$voucherName';
COMMIT;
SELECT COUNT(*) FROM nx_growth_voucher
 WHERE is_deleted=0 AND voucher_name='$voucherName';
"@ | Select-Object -Last 1 | ForEach-Object {
        if ($_ -ne '0') {
            throw "H7 voucher exact cleanup sentinel failed: $_"
        }
    }
}

function Assert-H3DatabaseEvidence {
    $runtimePath = Join-Path $EvidenceRoot 'h3-cas\business\cas-runtime.json'
    if (-not (Test-Path -LiteralPath $runtimePath)) {
        throw "H3 CAS runtime evidence missing: $runtimePath"
    }
    $runtime = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json
    $winnerKey = Escape-Sql ([string]$runtime.cas.winnerKey)
    $loserKey = Escape-Sql ([string]$runtime.cas.loserKey)
    $unknownKey = Escape-Sql ([string]$runtime.resultUnknown.key)
    if ([string]::IsNullOrWhiteSpace($winnerKey) -or
        [string]::IsNullOrWhiteSpace($loserKey) -or
        [string]::IsNullOrWhiteSpace($unknownKey)) {
        throw 'H3 CAS runtime evidence has empty idempotency keys'
    }
    $row = Invoke-MySql @"
SELECT
  (SELECT COUNT(*) FROM nx_admin_idempotency_record
    WHERE is_deleted=0 AND idempotency_key='$winnerKey' AND status='SUCCEEDED'),
  (SELECT COUNT(*) FROM nx_admin_idempotency_record
    WHERE is_deleted=0 AND idempotency_key='$loserKey' AND status='SUCCEEDED'
      AND CAST(response_json AS CHAR) LIKE '%QUEST_CONFIG_STALE%'),
  (SELECT COUNT(*) FROM nx_audit_log
    WHERE is_deleted=0 AND CAST(detail_json AS CHAR) LIKE '%$winnerKey%'),
  (SELECT COUNT(*) FROM nx_event_outbox
    WHERE is_deleted=0 AND CAST(payload AS CHAR) LIKE '%$winnerKey%'),
  (SELECT COUNT(*) FROM nx_audit_log
    WHERE is_deleted=0 AND CAST(detail_json AS CHAR) LIKE '%$loserKey%'),
  (SELECT COUNT(*) FROM nx_event_outbox
    WHERE is_deleted=0 AND CAST(payload AS CHAR) LIKE '%$loserKey%'),
  (SELECT COUNT(*) FROM nx_admin_idempotency_record
    WHERE is_deleted=0 AND idempotency_key='$unknownKey' AND status='SUCCEEDED'),
  (SELECT COUNT(*) FROM nx_audit_log
    WHERE is_deleted=0 AND CAST(detail_json AS CHAR) LIKE '%$unknownKey%'),
  (SELECT COUNT(*) FROM nx_event_outbox
    WHERE is_deleted=0 AND CAST(payload AS CHAR) LIKE '%$unknownKey%');
"@ | Select-Object -Last 1
    if ($row -ne "1`t1`t1`t1`t0`t0`t1`t1`t1") {
        throw "H3 CAS/idempotency/audit/outbox database proof failed: $row"
    }
    $proof = [ordered]@{
        winner = [ordered]@{ succeededIdempotency = 1; audit = 1; outbox = 1 }
        loser = [ordered]@{
            succeededStaleIdempotency = 1
            audit = 0
            outbox = 0
        }
        resultUnknownReplay = [ordered]@{
            succeededIdempotency = 1
            audit = 1
            outbox = 1
        }
    } | ConvertTo-Json -Depth 4
    [IO.File]::WriteAllText(
        (Join-Path $EvidenceRoot 'h3-cas\database-proof.json'),
        [string]::Concat($proof, [Environment]::NewLine)
    )
}

function Remove-H8MutableData {
    $privatePath = Join-Path $EvidenceRoot 'h8-app\cleanup-private.json'
    if (-not (Test-Path -LiteralPath $privatePath)) {
        return
    }
    $private = Get-Content -LiteralPath $privatePath -Raw | ConvertFrom-Json
    $publicPath = Join-Path $EvidenceRoot 'h8-app\app-referral-chain.json'
    if ([string]$private.runId -cne $script:H8WaveId) {
        throw 'H8 private cleanup manifest runId does not match the active App wave'
    }
    if (Test-Path -LiteralPath $publicPath) {
        $manifest = Get-Content -LiteralPath $publicPath -Raw | ConvertFrom-Json
        if ([string]$manifest.runId -cne $script:H8WaveId) {
            throw 'H8 public App manifest runId does not match the active App wave'
        }
        if ([string]$manifest.result -ceq 'PASS') {
            if ([string]$private.result -cne 'PASS' -or
                [long]$manifest.accounts.invitee.userId -ne [long]$private.accounts.invitee.userId -or
                [long]$manifest.accounts.inviter.userId -ne [long]$private.accounts.inviter.userId) {
                throw 'H8 PASS public/private manifests are not bound to the same cleanup identities'
            }
        }
    }
    $accounts = @($private.accounts.psobject.Properties | ForEach-Object { $_.Value })
    $ids = @($accounts | ForEach-Object { [long]$_.userId } | Where-Object { $_ -gt 0 } | Select-Object -Unique)
    if ($ids.Count -lt 1 -or $ids.Count -gt 2) {
        throw 'H8 cleanup manifest does not contain one or two distinct positive user IDs'
    }
    $idList = $ids -join ','
    $progressPath = Join-Path $EvidenceRoot 'h8-settlement\progress.json'
    $operationId = ''
    $settlementNo = ''
    if (Test-Path -LiteralPath $progressPath) {
        $progress = Get-Content -LiteralPath $progressPath -Raw | ConvertFrom-Json
        $operationId = [string]$progress.operationId
        $settlementNo = [string]$progress.settlementNo
    }
    if ($operationId -and $operationId -notmatch '^(WO|OP)-[A-Za-z0-9-]+$') {
        throw 'unexpected H8 operation ID in cleanup manifest'
    }
    if ($settlementNo -and $settlementNo -notmatch '^REF-[A-Z0-9]+$') {
        throw 'unexpected H8 settlement number in cleanup manifest'
    }
    $operation = Escape-Sql $operationId
    $settlement = Escape-Sql $settlementNo
    $phones = @($accounts | ForEach-Object {
        $phone = [string]$_.phone
        if (-not [string]::IsNullOrWhiteSpace($phone)) { "'$(Escape-Sql $phone)'" }
    })
    if ($phones.Count -lt 1) {
        throw 'H8 cleanup manifest does not contain a phone'
    }
    $phoneList = $phones -join ','

    Invoke-MySql @"
SET FOREIGN_KEY_CHECKS=0;
START TRANSACTION;
DELETE FROM nx_wallet_ledger
 WHERE user_id IN ($idList)
    OR ('$settlement'<>''
        AND (biz_no='$settlement' OR biz_no LIKE CONCAT('$settlement',':%')));
DELETE FROM nx_referral_reward_settlement
 WHERE invited_user_id IN ($idList) OR inviter_user_id IN ($idList)
    OR ('$settlement'<>'' AND settlement_no='$settlement');
DELETE FROM nx_user_session WHERE user_id IN ($idList);
DELETE FROM nx_user_wallet WHERE user_id IN ($idList);
DELETE FROM nx_user_security WHERE user_id IN ($idList);
DELETE FROM nx_user_registration_otp
 WHERE phone IN ($phoneList) AND country_code IN ('+81','81');
DELETE FROM nx_audit_object_lock
 WHERE '$operation'<>'' AND ticket_id='$operation';
DELETE FROM nx_audit_operation_ticket
 WHERE '$operation'<>'' AND operation_id='$operation';
DELETE FROM nx_user WHERE id IN ($idList);
COMMIT;
SET FOREIGN_KEY_CHECKS=1;
SELECT
  (SELECT COUNT(*) FROM nx_user WHERE id IN ($idList)),
  (SELECT COUNT(*) FROM nx_user_wallet WHERE user_id IN ($idList)),
  (SELECT COUNT(*) FROM nx_user_session WHERE user_id IN ($idList)),
  (SELECT COUNT(*) FROM nx_user_security WHERE user_id IN ($idList)),
  (SELECT COUNT(*) FROM nx_referral_reward_settlement
    WHERE invited_user_id IN ($idList) OR inviter_user_id IN ($idList)),
  (SELECT COUNT(*) FROM nx_wallet_ledger WHERE user_id IN ($idList)),
  (SELECT COUNT(*) FROM nx_user_registration_otp
    WHERE phone IN ($phoneList) AND country_code IN ('+81','81')),
  (SELECT COUNT(*) FROM nx_audit_object_lock
    WHERE '$operation'<>'' AND ticket_id='$operation'),
  (SELECT COUNT(*) FROM nx_audit_operation_ticket
    WHERE '$operation'<>'' AND operation_id='$operation');
"@ | Select-Object -Last 1 | ForEach-Object {
        if ($_ -ne "0`t0`t0`t0`t0`t0`t0`t0`t0") {
            throw "H8/H mutable cleanup sentinel failed: $_"
        }
    }
}

$preflightOnly = [Environment]::GetEnvironmentVariable('H_FINAL3_PREFLIGHT_ONLY') -eq '1'
$continuationMode = [Environment]::GetEnvironmentVariable('H_FINAL3_CONTINUATION')
if ([string]::IsNullOrWhiteSpace($continuationMode)) {
    $continuationMode = 'FULL'
}
if ($continuationMode -notin @('FULL', 'H8_ONLY')) {
    throw "unsupported H final3 continuation mode: $continuationMode"
}
$h8Continuation = $continuationMode -eq 'H8_ONLY'
if (-not $preflightOnly) {
    $leaseName = if ($h8Continuation) {
        'H_FINAL3_H8_CONTINUATION_TOKEN'
    }
    else {
        'H_FINAL3_OWNER_LEASE_TOKEN'
    }
    $lease = Require-Environment $leaseName
    if ($lease.Length -lt 8 -or $lease -eq '<main-controller-issued-token>') {
        throw "$leaseName is invalid"
    }
}
$script:DbPassword = Require-Environment 'NEXION_ACCEPTANCE_DB_PASSWORD'
$expectedJarHash = Require-Environment 'H_FINAL3_BACKEND_JAR_SHA256'
$expectedPcBuildId = Require-Environment 'H_FINAL3_PC_BUILD_ID'
if ($Database -notmatch '^nexion_acceptance_\d{8}_\d{6}_irreversible$') {
    throw "refusing non-isolated database: $Database"
}
if ($expectedPcBuildId -notmatch '^[A-Za-z0-9_-]{8,64}$') {
    throw 'H_FINAL3_PC_BUILD_ID is invalid'
}
foreach ($path in @($MysqlExe, $NodeExe, $NpxExe)) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "required executable missing: $path"
    }
}
$script:HFixturePath = $HFixturePath
if (-not (Test-Path -LiteralPath $script:HFixturePath)) {
    throw "H permission fixture missing: $script:HFixturePath"
}
$expectedFixtureHash = 'B2DEC27654B2422B373165F5EB4CE109B9C05B9D38567447F943E8E3FAE112B8'
$actualFixtureHash = (Get-FileHash -LiteralPath $script:HFixturePath -Algorithm SHA256).Hash
if ($actualFixtureHash -ne $expectedFixtureHash) {
    throw "H permission fixture hash mismatch: $actualFixtureHash"
}

New-Item -ItemType Directory -Path $EvidenceRoot -Force | Out-Null
Assert-Port 3302
Assert-Port 18110
Assert-Port 18111
$pcBuildPath = 'D:\workspace\nexion-ops-console\.next\BUILD_ID'
$diskPcBuildId = (Get-Content -LiteralPath $pcBuildPath -Raw).Trim()
if ($diskPcBuildId -ne $expectedPcBuildId) {
    throw "PC Build ID mismatch: $diskPcBuildId"
}
$pcProcess = Get-SinglePortProcess 3302
$pcBuildWrittenAt = (Get-Item -LiteralPath $pcBuildPath).LastWriteTimeUtc
if ($pcProcess.StartTime.ToUniversalTime() -lt $pcBuildWrittenAt) {
    throw "PC process $($pcProcess.Id) predates frozen Build ID"
}
$pcManifest = Invoke-WebRequest -UseBasicParsing `
    -Uri "$AdminBaseUrl/_next/static/$expectedPcBuildId/_buildManifest.js" `
    -TimeoutSec 15
if ($pcManifest.StatusCode -ne 200) {
    throw "running PC does not serve frozen Build ID $expectedPcBuildId"
}
$healthStatus = 0
$healthBody = ''
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
$healthUp = $healthStatus -eq 200 -and
    (($healthBody | ConvertFrom-Json).status -eq 'UP')
$healthFailClosed = $healthStatus -eq 401 -and $healthBody -match 'AUTH_REQUIRED'
if (-not $healthUp -and -not $healthFailClosed) {
    throw "backend health gate failed with HTTP $healthStatus"
}
$jar = 'D:\workspace\nexion-backend\target\nexion-backend-0.0.1-SNAPSHOT.jar'
$actualJarHash = (Get-FileHash -LiteralPath $jar -Algorithm SHA256).Hash
if ($actualJarHash -ne $expectedJarHash) {
    throw "backend JAR hash mismatch: $actualJarHash"
}
$backendProcess = Get-SinglePortProcess 18110
$jarWrittenAt = (Get-Item -LiteralPath $jar).LastWriteTimeUtc
if ($backendProcess.StartTime.ToUniversalTime() -lt $jarWrittenAt) {
    throw "backend process $($backendProcess.Id) predates frozen JAR"
}
$backendCommand = (Get-CimInstance Win32_Process -Filter "ProcessId=$($backendProcess.Id)").CommandLine
if ($backendCommand -notmatch '(?i)--nexion\.admin\.mfa\.temporary-superadmin-bypass=false') {
    throw 'backend process does not explicitly pin temporary superadmin MFA bypass=false'
}

$startedAt = Get-Date
$dbStartedAt = [string](Invoke-MySql "SELECT DATE_FORMAT(NOW(),'%Y-%m-%d %H:%i:%s');" | Select-Object -Last 1)
if ($dbStartedAt -notmatch '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$') {
    throw "child DB timestamp gate failed: $dbStartedAt"
}

$otpHandler = [Net.Http.HttpClientHandler]::new()
$otpHandler.UseProxy = $false
$otpClient = [Net.Http.HttpClient]::new($otpHandler)
try {
    $otpClient.Timeout = [TimeSpan]::FromSeconds(15)
    $otpResponse = $otpClient.GetAsync("$OtpSinkUrl/health").GetAwaiter().GetResult()
    if ([int]$otpResponse.StatusCode -ne 204) {
        throw "OTP sink health gate failed with HTTP $([int]$otpResponse.StatusCode)"
    }
}
finally {
    $otpClient.Dispose()
}

$syntaxTokens = $null
$syntaxErrors = $null
[Management.Automation.Language.Parser]::ParseFile(
    $PSCommandPath,
    [ref]$syntaxTokens,
    [ref]$syntaxErrors
) | Out-Null
if ($syntaxErrors.Count -ne 0) {
    throw "H final3 wrapper syntax gate failed: $($syntaxErrors[0].Message)"
}
& $NodeExe '--check' 'tests/e2e/h8-app-referral-chain-final3.mjs'
if ($LASTEXITCODE -ne 0) {
    throw 'H8 App harness syntax gate failed'
}

$listManifestPath = Join-Path $EvidenceRoot 'preflight-app-referral-chain.json'
$listOrderProofPath = Join-Path $EvidenceRoot 'preflight-target-order-proof.json'
[IO.File]::WriteAllText($listManifestPath, "{`"runId`":`"$RunId`",`"result`":`"PASS`",`"accounts`":{`"inviter`":{`"userId`":2},`"invitee`":{`"userId`":1}}}")
[IO.File]::WriteAllText($listOrderProofPath, "{`"runId`":`"$RunId`",`"invitedUserId`":1,`"inviterUserId`":2,`"targetEligibleCount`":1,`"targetIsFirstEligible`":true,`"eligibleBeforeTarget`":0,`"nonTargetFingerprintBefore`":`"$('-' * 64)`"}")
$listEnvironment = @{
    A_PERMISSION_FIXTURE = $script:HFixturePath
    H_PERMISSION_FIXTURE_PATH = $script:HFixturePath
    H_CHECKER_FIXTURE_PATH = $script:HFixturePath
    H_ACCEPTANCE_RUN_ID = $RunId
    H8_APP_MANIFEST_PATH = $listManifestPath
    H8_TARGET_ORDER_PROOF_PATH = $listOrderProofPath
}
$listPrevious = @{}
try {
    foreach ($key in $listEnvironment.Keys) {
        $listPrevious[$key] = [Environment]::GetEnvironmentVariable($key)
        [Environment]::SetEnvironmentVariable($key, [string]$listEnvironment[$key])
    }
    $listOutput = @(& $NpxExe playwright test `
        'tests/e2e/h-domain-permission-fixtures-20260728.spec.ts' `
        'tests/e2e/h-domain-failclosed-20260728.spec.ts' `
        'tests/e2e/h1-owner-acceptance-20260727.spec.ts' `
        'tests/e2e/h2-owner-acceptance-20260727.spec.ts' `
        'tests/e2e/h3-owner-acceptance-20260727.spec.ts' `
        'tests/e2e/h4-owner-acceptance-20260727.spec.ts' `
        'tests/e2e/h5-h7-first-user-live.spec.ts' `
        'tests/e2e/h8-owner-acceptance-20260727.spec.ts' `
        'tests/e2e/h3-two-operator-cas-20260728.spec.ts' `
        'tests/e2e/h8-real-settlement-20260728.spec.ts' `
        '--project=chromium' '--list' 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw "Playwright command discovery failed: $($listOutput -join [Environment]::NewLine)"
    }
}
finally {
    foreach ($key in $listEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($key, $listPrevious[$key])
    }
}
$listText = $listOutput -join [Environment]::NewLine
$listSha256 = Get-Sha256Hex ([Text.Encoding]::UTF8.GetBytes($listText))

$h3ProofSha256 = ''
if ($h8Continuation) {
    $expectedH3ProofSha256 = Require-Environment 'H_FINAL3_H3_PROOF_SHA256'
    if ($expectedH3ProofSha256 -notmatch '^[A-Fa-f0-9]{64}$') {
        throw 'H_FINAL3_H3_PROOF_SHA256 is invalid'
    }
    $h3ProofPath = Join-Path $EvidenceRoot 'h3-cas\database-proof.json'
    if (-not (Test-Path -LiteralPath $h3ProofPath)) {
        throw "H8 continuation requires H3 proof: $h3ProofPath"
    }
    $h3ProofSha256 = (Get-FileHash -LiteralPath $h3ProofPath -Algorithm SHA256).Hash
    if ($h3ProofSha256 -ne $expectedH3ProofSha256) {
        throw "H3 proof hash mismatch: $h3ProofSha256"
    }
    $h3Proof = Get-Content -LiteralPath $h3ProofPath -Raw | ConvertFrom-Json
    if ($h3Proof.runId -ne $RunId -or $h3Proof.status -ne 'PASS' -or
        $h3Proof.idempotencyStatusContract -ne 'SUCCEEDED') {
        throw 'H8 continuation H3 proof identity verification failed'
    }
}

if ($preflightOnly) {
    $preflight = [ordered]@{
        status = 'PREFLIGHT_ONLY_PASS'
        continuationMode = $continuationMode
        runId = $RunId
        pcBuildId = $diskPcBuildId
        pcPid = $pcProcess.Id
        pcManifestSha256 = Get-Sha256Hex ([Text.Encoding]::UTF8.GetBytes([string]$pcManifest.Content))
        backendJarSha256 = $actualJarHash
        backendPid = $backendProcess.Id
        mfaBypass = $false
        actuatorGate = if ($healthUp) { '200/UP' } else { '401/AUTH_REQUIRED' }
        database = $Database
        databaseTimestamp = $dbStartedAt
        fixtureSha256 = $actualFixtureHash
        otpSinkHealth = '204/HEALTH'
        commandDiscoverySha256 = $listSha256
        priorH3ProofSha256 = $h3ProofSha256
        finishedAt = (Get-Date).ToString('o')
    } | ConvertTo-Json -Depth 4
    $preflightPath = Join-Path $EvidenceRoot 'preflight-only-summary.json'
    [IO.File]::WriteAllText(
        $preflightPath,
        [string]::Concat($preflight, [Environment]::NewLine)
    )
    $preflightSha = (Get-FileHash -LiteralPath $preflightPath -Algorithm SHA256).Hash
    Write-Output "PREFLIGHT_ONLY_PASS $preflightPath SHA256=$preflightSha"
    exit 0
}

$waveId = "$RunId-H-FINAL3-$($startedAt.ToUniversalTime().ToString('yyyyMMddTHHmmssZ'))"
$script:ReserveNo = ''
$script:VoucherNo = ''
$script:ReserveInserted = $false
$script:ReserveLedgerBeforeUsd = [decimal]0
$script:B1PreSnapshot = $null
$script:B1CoverageLockPath = ''
$script:B1CoverageLockStream = $null
$script:B1CoverageLockOwned = $false
$script:B1CoverageLockWasOwned = $false
$script:H8WaveId = ''
$script:H8TargetUserId = [long]0
$script:H8TargetOriginalCreatedAt = ''
$script:H8TargetCreatedAtChanged = $false
$runFailed = $false
try {
    if (-not $h8Continuation) {
        Invoke-PlaywrightWave 'permission-matrix' 'tests/e2e/h-domain-permission-fixtures-20260728.spec.ts'
        Invoke-PlaywrightWave 'read-fault-matrix' 'tests/e2e/h-domain-failclosed-20260728.spec.ts'
        Invoke-PlaywrightWave 'h1' 'tests/e2e/h1-owner-acceptance-20260727.spec.ts'
        Invoke-PlaywrightWave 'h2' 'tests/e2e/h2-owner-acceptance-20260727.spec.ts' @{
            H2_EVIDENCE_DIR = (Join-Path $EvidenceRoot 'h2\business')
        }
        Invoke-PlaywrightWave 'h3-visible' 'tests/e2e/h3-owner-acceptance-20260727.spec.ts' @{
            H3_EVIDENCE_DIR = (Join-Path $EvidenceRoot 'h3-visible\business')
        }
        Invoke-PlaywrightWave 'h4' 'tests/e2e/h4-owner-acceptance-20260727.spec.ts' @{
            H4_EVIDENCE_DIR = (Join-Path $EvidenceRoot 'h4\business')
        }
        Invoke-PlaywrightWave 'h5-h7' 'tests/e2e/h5-h7-first-user-live.spec.ts' @{
            H57_EVIDENCE_DIR = (Join-Path $EvidenceRoot 'h5-h7\business')
        }
        Invoke-PlaywrightWave 'h8-visible-auth-boundary' 'tests/e2e/h8-owner-acceptance-20260727.spec.ts' @{
            H8_EVIDENCE_DIR = (Join-Path $EvidenceRoot 'h8-visible-auth-boundary\business')
        }
        Invoke-PlaywrightWave 'h3-cas' 'tests/e2e/h3-two-operator-cas-20260728.spec.ts' @{
            H3_CAS_EVIDENCE_DIR = (Join-Path $EvidenceRoot 'h3-cas\business')
        }
        Assert-H3DatabaseEvidence
    }

    $script:H8WaveId = $waveId
    $appDir = Join-Path $EvidenceRoot 'h8-app'
    New-Item -ItemType Directory -Path $appDir -Force | Out-Null
    $appEnv = @{
        H_FINAL3_BACKEND_URL = $BackendBaseUrl
        H_FINAL3_OTP_SINK_FILE = $OtpSinkFile
        H_FINAL3_EVIDENCE_RUN_ID = $RunId
        H_ACCEPTANCE_RUN_ID = $waveId
        H_FINAL3_APP_EVIDENCE_DIR = $appDir
    }
    $previous = @{}
    try {
        foreach ($key in $appEnv.Keys) {
            $previous[$key] = [Environment]::GetEnvironmentVariable($key)
            [Environment]::SetEnvironmentVariable($key, [string]$appEnv[$key])
        }
        & $NodeExe 'tests/e2e/h8-app-referral-chain-final3.mjs'
        if ($LASTEXITCODE -ne 0) {
            throw "H8 App referral chain failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        foreach ($key in $appEnv.Keys) {
            [Environment]::SetEnvironmentVariable($key, $previous[$key])
        }
    }

    $appManifestPath = Join-Path $appDir 'app-referral-chain.json'
    $privateManifestPath = Join-Path $appDir 'cleanup-private.json'
    $orderProofPath = New-H8TargetOrderProof $waveId $appManifestPath $privateManifestPath
    Enter-B1CoverageLock
    New-ReserveFixture $waveId
    Invoke-PlaywrightWave 'h8-settlement' 'tests/e2e/h8-real-settlement-20260728.spec.ts' @{
        H_ACCEPTANCE_RUN_ID = $waveId
        H8_SETTLEMENT_EVIDENCE_DIR = (Join-Path $EvidenceRoot 'h8-settlement')
        H8_APP_MANIFEST_PATH = (Join-Path $appDir 'app-referral-chain.json')
        H8_TARGET_ORDER_PROOF_PATH = $orderProofPath
    }
    Assert-H8TargetOutcome $appManifestPath $orderProofPath
    Write-B1PostSnapshot
}
catch {
    $runFailed = $true
    throw
}
finally {
    $cleanupErrors = [Collections.Generic.List[string]]::new()
    try { Restore-H8TargetOrderingFixture } catch { $cleanupErrors.Add($_.Exception.Message) }
    try { Remove-H8MutableData } catch { $cleanupErrors.Add($_.Exception.Message) }
    try { Remove-HMutableData } catch { $cleanupErrors.Add($_.Exception.Message) }
    try { Remove-ReserveFixture } catch { $cleanupErrors.Add($_.Exception.Message) }
    try { Assert-B1Restored } catch { $cleanupErrors.Add($_.Exception.Message) }
    try { Exit-B1CoverageLock } catch { $cleanupErrors.Add($_.Exception.Message) }
    if ($script:B1CoverageLockWasOwned -and
        -not [string]::IsNullOrWhiteSpace($script:B1CoverageLockPath) -and
        (Test-Path -LiteralPath $script:B1CoverageLockPath)) {
        $cleanupErrors.Add('global B1 coverage lock file still exists after release')
    }
    if ($cleanupErrors.Count -gt 0) {
        throw "H final3 cleanup failed: $($cleanupErrors -join '; ')"
    }
}

if (-not $runFailed) {
    $summary = [ordered]@{
        runId = $RunId
        waveId = $waveId
        status = 'PASS'
        continuationMode = $continuationMode
        priorH3ProofSha256 = $h3ProofSha256
        pc = $AdminBaseUrl
        pcBuildId = $diskPcBuildId
        pcPid = $pcProcess.Id
        backend = $BackendBaseUrl
        backendJarSha256 = $actualJarHash
        backendPid = $backendProcess.Id
        mfaBypass = $false
        startedAt = $startedAt.ToString('o')
        finishedAt = (Get-Date).ToString('o')
        cleanup = 'PASS'
    } | ConvertTo-Json -Depth 4
    [IO.File]::WriteAllText(
        (Join-Path $EvidenceRoot 'owner-summary.json'),
        [string]::Concat($summary, [Environment]::NewLine)
    )
}
