param(
    [Parameter(Mandatory = $true)]
    [string]$ManifestPath,
    [Parameter(Mandatory = $true)]
    [string]$EvidenceDir,
    [Parameter(Mandatory = $true)]
    [string]$ApprovedWriteToken,
    [string]$MysqlExe = "D:\software\MySQL\MySQL Server 8.0\bin\mysql.exe"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$FixtureLabel = "验收夹具、非产品路径"

if (-not $env:L4_FIXTURE_WRITE_TOKEN -or
    $env:L4_FIXTURE_WRITE_TOKEN -cne $ApprovedWriteToken) {
    throw "main-controller L4 fixture write token is missing or mismatched"
}
if (-not $env:MYSQL_PWD) {
    throw "MYSQL_PWD must be present in the process environment"
}
if (-not (Test-Path -LiteralPath $MysqlExe -PathType Leaf)) {
    throw "mysql client not found: $MysqlExe"
}
if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
    throw "fixture manifest not found: $ManifestPath"
}

$manifest = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json
if ($manifest.fixtureLabel -cne $FixtureLabel -or
    $manifest.runId -notmatch '^pc-full-acceptance-\d{8}-\d{6}$' -or
    $manifest.state -cne "COMMITTED") {
    throw "fixture manifest identity/state mismatch"
}
if ($manifest.database -notmatch '^nexion_acceptance_\d{8}_\d{6}$') {
    throw "unsafe acceptance database in fixture manifest"
}
$Database = [string]$manifest.database
$restrictedRoot = [System.IO.Path]::GetFullPath(
    "D:\workspace\bug-pic\.restricted\$($manifest.runId)\L\"
)
$resolvedEvidenceDir = [System.IO.Path]::GetFullPath($EvidenceDir)
if (-not $resolvedEvidenceDir.StartsWith($restrictedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "cleanup evidence directory must stay under the restricted L Run directory"
}
New-Item -ItemType Directory -Path $resolvedEvidenceDir -Force | Out-Null

function ConvertTo-SqlLiteral([string]$Value) {
    return "'" + $Value.Replace("'", "''") + "'"
}

function Invoke-Mysql([string]$Sql) {
    $output = & $MysqlExe --batch --raw --skip-column-names -uroot -D $Database --execute $Sql
    if ($LASTEXITCODE -ne 0) {
        throw "mysql command failed"
    }
    return @($output)
}

function Invoke-JsonRow([string]$Sql) {
    $lines = @(Invoke-Mysql $Sql)
    $line = @($lines | Where-Object { $_ -and $_.Trim() }) | Select-Object -Last 1
    if (-not $line) {
        throw "mysql JSON query returned no row"
    }
    return $line | ConvertFrom-Json
}

function Write-AtomicJson([string]$Path, [object]$Value) {
    $temporary = "$Path.tmp-$PID"
    $Value | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $temporary -Encoding utf8 -NoNewline
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Get-TeamFingerprint([string[]]$ExcludedMemberNos) {
    $exclude = ($ExcludedMemberNos | ForEach-Object { ConvertTo-SqlLiteral $_ }) -join ","
    return Invoke-JsonRow @"
SELECT JSON_OBJECT(
  'allCount', COUNT(*),
  'allIdSum', COALESCE(SUM(id), 0),
  'allCrcXor', COALESCE(BIT_XOR(CRC32(CONCAT_WS('|', id, user_id, member_user_id, member_no, nickname, v_rank, level, volume, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s'), DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s'), is_deleted))), 0),
  'recentExportCount', SUM(CASE WHEN is_deleted=0 AND level BETWEEN 1 AND 10 AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END),
  'recentExportCrcXor', COALESCE(BIT_XOR(CASE WHEN is_deleted=0 AND level BETWEEN 1 AND 10 AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    THEN CRC32(CONCAT_WS('|', id, user_id, member_user_id, v_rank, level, volume, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s'))) ELSE 0 END), 0)
)
FROM nx_team_member
WHERE member_no NOT IN ($exclude)
"@
}

function Assert-Count([object[]]$Rows, [int]$Expected, [string]$Label) {
    if (@($Rows).Count -ne $Expected) {
        throw "$Label manifest count mismatch"
    }
}

$users = @($manifest.users)
$kycProfiles = @($manifest.kycProfiles)
$sponsorships = @($manifest.sponsorships)
$teamRows = @($manifest.teamRows)
Assert-Count $users 3 "user"
Assert-Count $kycProfiles 3 "KYC"
Assert-Count $sponsorships 2 "sponsorship"
Assert-Count $teamRows 5 "team"

$userByNode = @{}
foreach ($user in $users) {
    if ($user.node -notin @("A", "B", "C") -or
        [int64]$user.id -le 0 -or
        [string]$user.phone -notmatch '^\d{6,15}$' -or
        [string]$user.referralCode -notmatch '^L4[ABC][A-F0-9]{12}$') {
        throw "unsafe user identity in fixture manifest"
    }
    $userByNode[[string]$user.node] = $user
}
$teamByEdge = @{}
foreach ($row in $teamRows) {
    if ($row.edge -notin @("A0", "B0", "C0", "AB", "BC") -or
        [int64]$row.id -le 0 -or
        [string]$row.memberNo -notmatch '^L4F-[A-F0-9]{12}-(A0|B0|C0|AB|BC)$') {
        throw "unsafe team identity in fixture manifest"
    }
    $teamByEdge[[string]$row.edge] = $row
}
$sponsorshipByEdge = @{}
foreach ($row in $sponsorships) {
    if ($row.edge -notin @("AB", "BC") -or [int64]$row.id -le 0) {
        throw "unsafe sponsorship identity in fixture manifest"
    }
    $sponsorshipByEdge[[string]$row.edge] = $row
}
$kycByUserId = @{}
foreach ($row in $kycProfiles) {
    if ([int64]$row.id -le 0 -or
        [int64]$row.userId -le 0 -or
        [string]$row.kycNo -notmatch '^KYC-\d+$' -or
        [string]$row.triggerSource -cne "REGISTRATION") {
        throw "unsafe KYC identity in fixture manifest"
    }
    $kycByUserId[[string]$row.userId] = $row
}

$fixtureTsValue = $manifest.fixtureTs
$fixtureTsText = if ($fixtureTsValue -is [datetime]) {
    $fixtureTsValue.ToString(
        "yyyy-MM-ddTHH:mm:ss",
        [System.Globalization.CultureInfo]::InvariantCulture
    )
} else {
    [string]$fixtureTsValue
}
if ($fixtureTsText -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$') {
    throw "unsafe fixture timestamp in fixture manifest"
}
$fixtureTs = ConvertTo-SqlLiteral $fixtureTsText
$a = $userByNode.A
$b = $userByNode.B
$c = $userByNode.C
$aId = [int64]$a.id
$bId = [int64]$b.id
$cId = [int64]$c.id
$aPhone = ConvertTo-SqlLiteral ([string]$a.phone)
$bPhone = ConvertTo-SqlLiteral ([string]$b.phone)
$cPhone = ConvertTo-SqlLiteral ([string]$c.phone)
$aRef = ConvertTo-SqlLiteral ([string]$a.referralCode)
$bRef = ConvertTo-SqlLiteral ([string]$b.referralCode)
$cRef = ConvertTo-SqlLiteral ([string]$c.referralCode)
$a0 = $teamByEdge.A0
$b0 = $teamByEdge.B0
$c0 = $teamByEdge.C0
$ab = $teamByEdge.AB
$bc = $teamByEdge.BC
$memberNos = @($teamRows | ForEach-Object { [string]$_.memberNo })
$beforeCleanup = [ordered]@{
    generatedAt = (Get-Date).ToString("o")
    fixtureLabel = $FixtureLabel
    manifestSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $ManifestPath).Hash
    fixtureRows = Invoke-JsonRow @"
SELECT JSON_OBJECT(
  'users', (SELECT COUNT(*) FROM nx_user WHERE id IN ($aId,$bId,$cId)),
  'kyc', (SELECT COUNT(*) FROM nx_kyc_profile WHERE user_id IN ($aId,$bId,$cId)),
  'sponsorships', (SELECT COUNT(*) FROM nx_sponsorship WHERE id IN ($([int64]$sponsorshipByEdge.AB.id),$([int64]$sponsorshipByEdge.BC.id))),
  'team', (SELECT COUNT(*) FROM nx_team_member WHERE id IN ($([int64]$a0.id),$([int64]$b0.id),$([int64]$c0.id),$([int64]$ab.id),$([int64]$bc.id)))
)
"@
}
Write-AtomicJson (Join-Path $resolvedEvidenceDir "before-fixture-cleanup.json") $beforeCleanup

$cleanupResult = $null
$cleanupError = $null
try {
    $cleanupResult = Invoke-JsonRow @"
CREATE TEMPORARY TABLE l4_fixture_cleanup_assert (
  ok TINYINT NOT NULL,
  CONSTRAINT chk_l4_fixture_cleanup_assert CHECK (ok = 1)
);
START TRANSACTION;
INSERT INTO l4_fixture_cleanup_assert
SELECT IF(
  (SELECT COUNT(*) FROM nx_user
    WHERE (id=$aId AND phone=$aPhone AND referral_code=$aRef AND status='ACTIVE' AND is_deleted=0) OR
          (id=$bId AND phone=$bPhone AND referral_code=$bRef AND sponsor_user_id=$aId AND sponsor_code=$aRef AND status='ACTIVE' AND is_deleted=0) OR
          (id=$cId AND phone=$cPhone AND referral_code=$cRef AND sponsor_user_id=$bId AND sponsor_code=$bRef AND status='ACTIVE' AND is_deleted=0)
  )=3
  AND (SELECT COUNT(*) FROM nx_kyc_profile
    WHERE (id=$([int64]$kycByUserId[[string]$aId].id) AND user_id=$aId AND kyc_no=$(ConvertTo-SqlLiteral ([string]$kycByUserId[[string]$aId].kycNo)) AND status='PENDING' AND trigger_source='REGISTRATION' AND is_deleted=0) OR
          (id=$([int64]$kycByUserId[[string]$bId].id) AND user_id=$bId AND kyc_no=$(ConvertTo-SqlLiteral ([string]$kycByUserId[[string]$bId].kycNo)) AND status='PENDING' AND trigger_source='REGISTRATION' AND is_deleted=0) OR
          (id=$([int64]$kycByUserId[[string]$cId].id) AND user_id=$cId AND kyc_no=$(ConvertTo-SqlLiteral ([string]$kycByUserId[[string]$cId].kycNo)) AND status='PENDING' AND trigger_source='REGISTRATION' AND is_deleted=0)
  )=3
  AND (SELECT COUNT(*) FROM nx_sponsorship
    WHERE (id=$([int64]$sponsorshipByEdge.AB.id) AND user_id=$bId AND sponsor_user_id=$aId AND sponsor_code=$aRef AND bound_at=STR_TO_DATE($fixtureTs,'%Y-%m-%dT%H:%i:%s') AND is_deleted=0) OR
          (id=$([int64]$sponsorshipByEdge.BC.id) AND user_id=$cId AND sponsor_user_id=$bId AND sponsor_code=$bRef AND bound_at=STR_TO_DATE($fixtureTs,'%Y-%m-%dT%H:%i:%s') AND is_deleted=0)
  )=2,
  1, 0
);
INSERT INTO l4_fixture_cleanup_assert
SELECT IF(
  (SELECT COUNT(*) FROM nx_team_member
    WHERE (id=$([int64]$a0.id) AND user_id=$aId AND member_user_id=$aId AND member_no=$(ConvertTo-SqlLiteral ([string]$a0.memberNo)) AND nickname='L4 Fixture A' AND v_rank='V0' AND level=0 AND volume=0 AND created_at=STR_TO_DATE($fixtureTs,'%Y-%m-%dT%H:%i:%s') AND is_deleted=0) OR
          (id=$([int64]$b0.id) AND user_id=$bId AND member_user_id=$bId AND member_no=$(ConvertTo-SqlLiteral ([string]$b0.memberNo)) AND nickname='L4 Fixture B' AND v_rank='V0' AND level=0 AND volume=0 AND created_at=STR_TO_DATE($fixtureTs,'%Y-%m-%dT%H:%i:%s') AND is_deleted=0) OR
          (id=$([int64]$c0.id) AND user_id=$cId AND member_user_id=$cId AND member_no=$(ConvertTo-SqlLiteral ([string]$c0.memberNo)) AND nickname='L4 Fixture C' AND v_rank='V0' AND level=0 AND volume=0 AND created_at=STR_TO_DATE($fixtureTs,'%Y-%m-%dT%H:%i:%s') AND is_deleted=0) OR
          (id=$([int64]$ab.id) AND user_id=$aId AND member_user_id=$bId AND member_no=$(ConvertTo-SqlLiteral ([string]$ab.memberNo)) AND nickname='L4 Fixture B' AND v_rank='V0' AND level=1 AND volume=0 AND created_at=STR_TO_DATE($fixtureTs,'%Y-%m-%dT%H:%i:%s') AND is_deleted=0) OR
          (id=$([int64]$bc.id) AND user_id=$bId AND member_user_id=$cId AND member_no=$(ConvertTo-SqlLiteral ([string]$bc.memberNo)) AND nickname='L4 Fixture C' AND v_rank='V0' AND level=1 AND volume=0 AND created_at=STR_TO_DATE($fixtureTs,'%Y-%m-%dT%H:%i:%s') AND is_deleted=0)
  )=5,
  1, 0
);

DELETE FROM nx_team_member
 WHERE (id=$([int64]$a0.id) AND user_id=$aId AND member_user_id=$aId AND member_no=$(ConvertTo-SqlLiteral ([string]$a0.memberNo)) AND level=0) OR
       (id=$([int64]$b0.id) AND user_id=$bId AND member_user_id=$bId AND member_no=$(ConvertTo-SqlLiteral ([string]$b0.memberNo)) AND level=0) OR
       (id=$([int64]$c0.id) AND user_id=$cId AND member_user_id=$cId AND member_no=$(ConvertTo-SqlLiteral ([string]$c0.memberNo)) AND level=0) OR
       (id=$([int64]$ab.id) AND user_id=$aId AND member_user_id=$bId AND member_no=$(ConvertTo-SqlLiteral ([string]$ab.memberNo)) AND level=1) OR
       (id=$([int64]$bc.id) AND user_id=$bId AND member_user_id=$cId AND member_no=$(ConvertTo-SqlLiteral ([string]$bc.memberNo)) AND level=1);
SET @deleted_team=ROW_COUNT();
DELETE FROM nx_sponsorship
 WHERE (id=$([int64]$sponsorshipByEdge.AB.id) AND user_id=$bId AND sponsor_user_id=$aId AND sponsor_code=$aRef) OR
       (id=$([int64]$sponsorshipByEdge.BC.id) AND user_id=$cId AND sponsor_user_id=$bId AND sponsor_code=$bRef);
SET @deleted_sponsorship=ROW_COUNT();
DELETE FROM nx_kyc_profile
 WHERE (id=$([int64]$kycByUserId[[string]$aId].id) AND user_id=$aId AND kyc_no=$(ConvertTo-SqlLiteral ([string]$kycByUserId[[string]$aId].kycNo)) AND trigger_source='REGISTRATION') OR
       (id=$([int64]$kycByUserId[[string]$bId].id) AND user_id=$bId AND kyc_no=$(ConvertTo-SqlLiteral ([string]$kycByUserId[[string]$bId].kycNo)) AND trigger_source='REGISTRATION') OR
       (id=$([int64]$kycByUserId[[string]$cId].id) AND user_id=$cId AND kyc_no=$(ConvertTo-SqlLiteral ([string]$kycByUserId[[string]$cId].kycNo)) AND trigger_source='REGISTRATION');
SET @deleted_kyc=ROW_COUNT();
DELETE FROM nx_user
 WHERE (id=$aId AND phone=$aPhone AND referral_code=$aRef) OR
       (id=$bId AND phone=$bPhone AND referral_code=$bRef) OR
       (id=$cId AND phone=$cPhone AND referral_code=$cRef);
SET @deleted_users=ROW_COUNT();
INSERT INTO l4_fixture_cleanup_assert
SELECT IF(@deleted_team=5 AND @deleted_sponsorship=2 AND @deleted_kyc=3 AND @deleted_users=3, 1, 0);
COMMIT;
SELECT JSON_OBJECT(
  'deletedTeam',@deleted_team,
  'deletedSponsorships',@deleted_sponsorship,
  'deletedKyc',@deleted_kyc,
  'deletedUsers',@deleted_users,
  'remainingTeam',(SELECT COUNT(*) FROM nx_team_member WHERE id IN ($([int64]$a0.id),$([int64]$b0.id),$([int64]$c0.id),$([int64]$ab.id),$([int64]$bc.id))),
  'remainingSponsorships',(SELECT COUNT(*) FROM nx_sponsorship WHERE id IN ($([int64]$sponsorshipByEdge.AB.id),$([int64]$sponsorshipByEdge.BC.id))),
  'remainingKyc',(SELECT COUNT(*) FROM nx_kyc_profile WHERE user_id IN ($aId,$bId,$cId)),
  'remainingUsers',(SELECT COUNT(*) FROM nx_user WHERE id IN ($aId,$bId,$cId))
);
"@
}
catch {
    $cleanupError = $_.Exception.Message
    throw
}
finally {
    $afterFingerprint = Get-TeamFingerprint $memberNos
    $fingerprintMatches =
        [string]$afterFingerprint.allCount -ceq [string]$manifest.beforeTeamFingerprint.allCount -and
        [string]$afterFingerprint.allIdSum -ceq [string]$manifest.beforeTeamFingerprint.allIdSum -and
        [string]$afterFingerprint.allCrcXor -ceq [string]$manifest.beforeTeamFingerprint.allCrcXor
    $cleanupPassed = $null -ne $cleanupResult -and
        $cleanupResult.remainingTeam -eq 0 -and
        $cleanupResult.remainingSponsorships -eq 0 -and
        $cleanupResult.remainingKyc -eq 0 -and
        $cleanupResult.remainingUsers -eq 0 -and
        $fingerprintMatches
    $evidence = [ordered]@{
        fixtureLabel = $FixtureLabel
        generatedAt = (Get-Date).ToString("o")
        manifestPath = $ManifestPath
        manifestSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $ManifestPath).Hash
        result = $cleanupResult
        cleanupError = $cleanupError
        beforeTeamFingerprint = $manifest.beforeTeamFingerprint
        afterTeamFingerprint = $afterFingerprint
        nonFixtureTeamFingerprintRestored = $fingerprintMatches
        immutableA2A4Retained = $true
        cleanupPassed = $cleanupPassed
    }
    Write-AtomicJson (Join-Path $resolvedEvidenceDir "exact-fixture-cleanup-result.json") $evidence
    if (-not $cleanupPassed -and -not $cleanupError) {
        throw "exact fixture cleanup verification failed"
    }
}
