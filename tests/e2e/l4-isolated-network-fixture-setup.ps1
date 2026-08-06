param(
    [Parameter(Mandatory = $true)]
    [string]$RunId,
    [Parameter(Mandatory = $true)]
    [string]$EvidenceDir,
    [Parameter(Mandatory = $true)]
    [string]$ApprovedWriteToken,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedPcBuildId,
    [Parameter(Mandatory = $true)]
    [int]$ExpectedPcPid,
    [Parameter(Mandatory = $true)]
    [int]$ExpectedBackendPid,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedBackendJarSha256,
    [string]$Database = "nexion_acceptance_20260729_114336",
    [string]$MysqlExe = "D:\software\MySQL\MySQL Server 8.0\bin\mysql.exe",
    [string]$PcBuildIdPath = "D:\workspace\nexion-ops-console\.next\BUILD_ID",
    [string]$BackendJarPath = "D:\workspace\nexion-backend\target\nexion-backend-0.0.1-SNAPSHOT.jar"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# This is an acceptance-only carrier. It does not represent App registration or
# referral production behavior.
$FixtureLabel = "验收夹具、非产品路径"
$ExpectedUserCount = 3
$ExpectedSponsorshipCount = 2
$ExpectedTeamCount = 5
$ExpectedKycCount = 3
$FixturePasswordHash = '$2a$10$IPabDA.89TrSOBbFNdsPDejK6ip8ywMtoYds8SWtmjhSpN4sK9mFG'
$RestrictedRoot = [System.IO.Path]::GetFullPath("D:\workspace\bug-pic\.restricted\$RunId\L\")

if ($RunId -notmatch '^pc-full-acceptance-\d{8}-\d{6}$') {
    throw "unsafe Run ID"
}
if (-not $env:L4_FIXTURE_WRITE_TOKEN -or
    $env:L4_FIXTURE_WRITE_TOKEN -cne $ApprovedWriteToken) {
    throw "main-controller L4 fixture write token is missing or mismatched"
}
if ($Database -notmatch '^nexion_acceptance_\d{8}_\d{6}$') {
    throw "unsafe acceptance database"
}
if (-not $env:MYSQL_PWD) {
    throw "MYSQL_PWD must be present in the process environment"
}
if (-not (Test-Path -LiteralPath $MysqlExe -PathType Leaf)) {
    throw "mysql client not found: $MysqlExe"
}
if (-not (Test-Path -LiteralPath $PcBuildIdPath -PathType Leaf)) {
    throw "PC BUILD_ID not found: $PcBuildIdPath"
}
if (-not (Test-Path -LiteralPath $BackendJarPath -PathType Leaf)) {
    throw "backend jar not found: $BackendJarPath"
}

$resolvedEvidenceDir = [System.IO.Path]::GetFullPath($EvidenceDir)
if (-not $resolvedEvidenceDir.StartsWith($RestrictedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "evidence directory must stay under the restricted L Run directory"
}
if ((Get-Content -Raw -LiteralPath $PcBuildIdPath).Trim() -cne $ExpectedPcBuildId) {
    throw "PC BUILD_ID drifted before fixture setup"
}
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $BackendJarPath).Hash -cne
    $ExpectedBackendJarSha256.ToUpperInvariant()) {
    throw "backend jar hash drifted before fixture setup"
}
if (-not (Get-Process -Id $ExpectedPcPid -ErrorAction SilentlyContinue)) {
    throw "locked PC process is not running"
}
if (-not (Get-Process -Id $ExpectedBackendPid -ErrorAction SilentlyContinue)) {
    throw "locked backend process is not running"
}

New-Item -ItemType Directory -Path $resolvedEvidenceDir -Force | Out-Null
$intentPath = Join-Path $resolvedEvidenceDir "fixture-intent.json"
$manifestPath = Join-Path $resolvedEvidenceDir "fixture-manifest.json"
$fallbackCleanupPath = Join-Path $resolvedEvidenceDir "setup-fallback-cleanup.json"

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

function Invoke-ExactFallbackCleanup([object]$Markers, [object]$BeforeFingerprint) {
    $refA = ConvertTo-SqlLiteral $Markers.referralCodes.A
    $refB = ConvertTo-SqlLiteral $Markers.referralCodes.B
    $refC = ConvertTo-SqlLiteral $Markers.referralCodes.C
    $phoneA = ConvertTo-SqlLiteral $Markers.phones.A
    $phoneB = ConvertTo-SqlLiteral $Markers.phones.B
    $phoneC = ConvertTo-SqlLiteral $Markers.phones.C
    $memberNos = @($Markers.memberNos.PSObject.Properties.Value)
    $memberNoList = ($memberNos | ForEach-Object { ConvertTo-SqlLiteral ([string]$_) }) -join ","

    $result = Invoke-JsonRow @"
CREATE TEMPORARY TABLE l4_fixture_cleanup_assert (
  ok TINYINT NOT NULL,
  CONSTRAINT chk_l4_fixture_cleanup_assert CHECK (ok = 1)
);
START TRANSACTION;
SET @user_a = (SELECT id FROM nx_user WHERE referral_code=$refA AND phone=$phoneA AND is_deleted=0 LIMIT 1);
SET @user_b = (SELECT id FROM nx_user WHERE referral_code=$refB AND phone=$phoneB AND is_deleted=0 LIMIT 1);
SET @user_c = (SELECT id FROM nx_user WHERE referral_code=$refC AND phone=$phoneC AND is_deleted=0 LIMIT 1);
INSERT INTO l4_fixture_cleanup_assert VALUES (
  IF((SELECT COUNT(*) FROM nx_user WHERE referral_code IN ($refA,$refB,$refC)) <= 3, 1, 0)
);
DELETE FROM nx_team_member
 WHERE member_no IN ($memberNoList)
   AND (
     (user_id=@user_a AND member_user_id=@user_a AND level=0) OR
     (user_id=@user_b AND member_user_id=@user_b AND level=0) OR
     (user_id=@user_c AND member_user_id=@user_c AND level=0) OR
     (user_id=@user_a AND member_user_id=@user_b AND level=1) OR
     (user_id=@user_b AND member_user_id=@user_c AND level=1)
   );
DELETE FROM nx_sponsorship
 WHERE (user_id=@user_b AND sponsor_user_id=@user_a AND sponsor_code=$refA)
    OR (user_id=@user_c AND sponsor_user_id=@user_b AND sponsor_code=$refB);
DELETE FROM nx_kyc_profile WHERE user_id IN (@user_a,@user_b,@user_c) AND trigger_source='REGISTRATION';
DELETE FROM nx_user
 WHERE (id=@user_a AND referral_code=$refA AND phone=$phoneA) OR
       (id=@user_b AND referral_code=$refB AND phone=$phoneB) OR
       (id=@user_c AND referral_code=$refC AND phone=$phoneC);
COMMIT;
SELECT JSON_OBJECT(
  'fixtureUsersRemaining', (SELECT COUNT(*) FROM nx_user WHERE referral_code IN ($refA,$refB,$refC)),
  'fixtureTeamRemaining', (SELECT COUNT(*) FROM nx_team_member WHERE member_no IN ($memberNoList)),
  'fixtureSponsorshipRemaining', (SELECT COUNT(*) FROM nx_sponsorship WHERE user_id IN (@user_a,@user_b,@user_c)),
  'fixtureKycRemaining', (SELECT COUNT(*) FROM nx_kyc_profile WHERE user_id IN (@user_a,@user_b,@user_c))
);
"@
    $afterFingerprint = Get-TeamFingerprint $memberNos
    $evidence = [ordered]@{
        fixtureLabel = $FixtureLabel
        generatedAt = (Get-Date).ToString("o")
        reason = "setup did not reach a durable manifest; exact marker cleanup ran"
        result = $result
        beforeFingerprint = $BeforeFingerprint
        afterFingerprint = $afterFingerprint
    }
    Write-AtomicJson $fallbackCleanupPath $evidence
    if ($result.fixtureUsersRemaining -ne 0 -or
        $result.fixtureTeamRemaining -ne 0 -or
        $result.fixtureSponsorshipRemaining -ne 0 -or
        $result.fixtureKycRemaining -ne 0) {
        throw "setup fallback cleanup left fixture rows"
    }
}

$hashBytes = [System.Security.Cryptography.SHA256]::HashData(
    [System.Text.Encoding]::UTF8.GetBytes($RunId)
)
$shortHash = ([Convert]::ToHexString($hashBytes)).Substring(0, 12)
$runDigits = $RunId -replace '\D', ''
$phoneSeed = $runDigits.Substring($runDigits.Length - 10)
$fixtureKey = "L4F-$shortHash"
$markers = [ordered]@{
    fixtureKey = $fixtureKey
    phones = [ordered]@{
        A = "7${phoneSeed}01"
        B = "7${phoneSeed}02"
        C = "7${phoneSeed}03"
    }
    referralCodes = [ordered]@{
        A = "L4A$shortHash"
        B = "L4B$shortHash"
        C = "L4C$shortHash"
    }
    memberNos = [ordered]@{
        A0 = "$fixtureKey-A0"
        B0 = "$fixtureKey-B0"
        C0 = "$fixtureKey-C0"
        AB = "$fixtureKey-AB"
        BC = "$fixtureKey-BC"
    }
}
$memberNos = @($markers.memberNos.Values)
$beforeFingerprint = Get-TeamFingerprint $memberNos

$phoneA = ConvertTo-SqlLiteral $markers.phones.A
$phoneB = ConvertTo-SqlLiteral $markers.phones.B
$phoneC = ConvertTo-SqlLiteral $markers.phones.C
$refA = ConvertTo-SqlLiteral $markers.referralCodes.A
$refB = ConvertTo-SqlLiteral $markers.referralCodes.B
$refC = ConvertTo-SqlLiteral $markers.referralCodes.C
$memberA0 = ConvertTo-SqlLiteral $markers.memberNos.A0
$memberB0 = ConvertTo-SqlLiteral $markers.memberNos.B0
$memberC0 = ConvertTo-SqlLiteral $markers.memberNos.C0
$memberAB = ConvertTo-SqlLiteral $markers.memberNos.AB
$memberBC = ConvertTo-SqlLiteral $markers.memberNos.BC
$passwordHash = ConvertTo-SqlLiteral $FixturePasswordHash

$preflight = Invoke-JsonRow @"
SELECT JSON_OBJECT(
  'users', (SELECT COUNT(*) FROM nx_user WHERE phone IN ($phoneA,$phoneB,$phoneC) OR referral_code IN ($refA,$refB,$refC)),
  'team', (SELECT COUNT(*) FROM nx_team_member WHERE member_no IN ($memberA0,$memberB0,$memberC0,$memberAB,$memberBC)),
  'sponsorships', (SELECT COUNT(*) FROM nx_sponsorship WHERE sponsor_code IN ($refA,$refB,$refC)),
  'clientIpColumn', (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='nx_user' AND COLUMN_NAME='client_ip'),
  'requiredKycTrigger', (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME='trg_nx_user_kyc_profile')
)
"@
if ($preflight.users -ne 0 -or $preflight.team -ne 0 -or $preflight.sponsorships -ne 0) {
    throw "run-scoped L4 fixture markers already exist"
}
if ($preflight.requiredKycTrigger -ne 1) {
    throw "required nx_user -> nx_kyc_profile trigger is unavailable or ambiguous"
}
$clientIpColumn = if ($preflight.clientIpColumn -eq 1) { ",client_ip" } else { "" }
$clientIpValue = if ($preflight.clientIpColumn -eq 1) { ",'127.0.0.1'" } else { "" }
$preflightConfirmed = $true

$intent = [ordered]@{
    fixtureLabel = $FixtureLabel
    runId = $RunId
    state = "INTENT_ONLY"
    generatedAt = (Get-Date).ToString("o")
    database = $Database
    expectedCounts = [ordered]@{
        users = $ExpectedUserCount
        sponsorships = $ExpectedSponsorshipCount
        teamRows = $ExpectedTeamCount
        kycProfiles = $ExpectedKycCount
    }
    candidate = [ordered]@{
        pcBuildId = $ExpectedPcBuildId
        pcPid = $ExpectedPcPid
        backendPid = $ExpectedBackendPid
        backendJarSha256 = $ExpectedBackendJarSha256.ToUpperInvariant()
    }
    markers = $markers
    beforeTeamFingerprint = $beforeFingerprint
    cleanupContract = "caller must invoke l4-isolated-network-fixture-cleanup.ps1 from finally"
}
Write-AtomicJson $intentPath $intent

$setupCommitted = $false
try {
    $created = Invoke-JsonRow @"
CREATE TEMPORARY TABLE l4_fixture_assert (
  ok TINYINT NOT NULL,
  CONSTRAINT chk_l4_fixture_assert CHECK (ok = 1)
);
START TRANSACTION;
INSERT INTO l4_fixture_assert
SELECT IF(
  (SELECT COUNT(*) FROM nx_user WHERE phone IN ($phoneA,$phoneB,$phoneC) OR referral_code IN ($refA,$refB,$refC))=0
  AND (SELECT COUNT(*) FROM nx_team_member WHERE member_no IN ($memberA0,$memberB0,$memberC0,$memberAB,$memberBC))=0,
  1, 0
);
SET @fixture_ts = NOW();

INSERT INTO nx_user
  (country_code,phone$clientIpColumn,password_hash,nickname,referral_code,sponsor_user_id,sponsor_code,
   kyc_status,user_level,v_rank,status,language,created_at,updated_at,is_deleted)
VALUES
  ('+1',$phoneA$clientIpValue,$passwordHash,'L4 Fixture A',$refA,NULL,NULL,
   'PENDING','L1','V0','ACTIVE','en-US',@fixture_ts,@fixture_ts,0);
SET @user_a=LAST_INSERT_ID();

INSERT INTO nx_user
  (country_code,phone$clientIpColumn,password_hash,nickname,referral_code,sponsor_user_id,sponsor_code,
   kyc_status,user_level,v_rank,status,language,created_at,updated_at,is_deleted)
VALUES
  ('+1',$phoneB$clientIpValue,$passwordHash,'L4 Fixture B',$refB,@user_a,$refA,
   'PENDING','L1','V0','ACTIVE','en-US',@fixture_ts,@fixture_ts,0);
SET @user_b=LAST_INSERT_ID();

INSERT INTO nx_user
  (country_code,phone$clientIpColumn,password_hash,nickname,referral_code,sponsor_user_id,sponsor_code,
   kyc_status,user_level,v_rank,status,language,created_at,updated_at,is_deleted)
VALUES
  ('+1',$phoneC$clientIpValue,$passwordHash,'L4 Fixture C',$refC,@user_b,$refB,
   'PENDING','L1','V0','ACTIVE','en-US',@fixture_ts,@fixture_ts,0);
SET @user_c=LAST_INSERT_ID();

INSERT INTO nx_sponsorship
  (user_id,sponsor_user_id,sponsor_code,bound_at,created_at,updated_at,is_deleted)
VALUES (@user_b,@user_a,$refA,@fixture_ts,@fixture_ts,@fixture_ts,0);
SET @sponsor_b=LAST_INSERT_ID();
INSERT INTO nx_sponsorship
  (user_id,sponsor_user_id,sponsor_code,bound_at,created_at,updated_at,is_deleted)
VALUES (@user_c,@user_b,$refB,@fixture_ts,@fixture_ts,@fixture_ts,0);
SET @sponsor_c=LAST_INSERT_ID();

INSERT INTO nx_team_member
  (user_id,member_user_id,member_no,nickname,v_rank,level,volume,created_at,updated_at,is_deleted)
VALUES (@user_a,@user_a,$memberA0,'L4 Fixture A','V0',0,0,@fixture_ts,@fixture_ts,0);
SET @team_a0=LAST_INSERT_ID();
INSERT INTO nx_team_member
  (user_id,member_user_id,member_no,nickname,v_rank,level,volume,created_at,updated_at,is_deleted)
VALUES (@user_b,@user_b,$memberB0,'L4 Fixture B','V0',0,0,@fixture_ts,@fixture_ts,0);
SET @team_b0=LAST_INSERT_ID();
INSERT INTO nx_team_member
  (user_id,member_user_id,member_no,nickname,v_rank,level,volume,created_at,updated_at,is_deleted)
VALUES (@user_c,@user_c,$memberC0,'L4 Fixture C','V0',0,0,@fixture_ts,@fixture_ts,0);
SET @team_c0=LAST_INSERT_ID();
INSERT INTO nx_team_member
  (user_id,member_user_id,member_no,nickname,v_rank,level,volume,created_at,updated_at,is_deleted)
VALUES (@user_a,@user_b,$memberAB,'L4 Fixture B','V0',1,0,@fixture_ts,@fixture_ts,0);
SET @team_ab=LAST_INSERT_ID();
INSERT INTO nx_team_member
  (user_id,member_user_id,member_no,nickname,v_rank,level,volume,created_at,updated_at,is_deleted)
VALUES (@user_b,@user_c,$memberBC,'L4 Fixture C','V0',1,0,@fixture_ts,@fixture_ts,0);
SET @team_bc=LAST_INSERT_ID();

INSERT INTO l4_fixture_assert
SELECT IF(
  (SELECT COUNT(*) FROM nx_user WHERE id IN (@user_a,@user_b,@user_c) AND status='ACTIVE' AND is_deleted=0)=3
  AND (SELECT COUNT(*) FROM nx_kyc_profile WHERE user_id IN (@user_a,@user_b,@user_c) AND status='PENDING' AND trigger_source='REGISTRATION' AND is_deleted=0)=3
  AND (SELECT COUNT(*) FROM nx_sponsorship WHERE id IN (@sponsor_b,@sponsor_c) AND is_deleted=0)=2
  AND (SELECT COUNT(*) FROM nx_team_member WHERE id IN (@team_a0,@team_b0,@team_c0,@team_ab,@team_bc) AND is_deleted=0)=5,
  1, 0
);
INSERT INTO l4_fixture_assert
SELECT IF(
  (SELECT COUNT(*) FROM nx_user WHERE id=@user_b AND sponsor_user_id=@user_a AND sponsor_code=$refA)=1
  AND (SELECT COUNT(*) FROM nx_user WHERE id=@user_c AND sponsor_user_id=@user_b AND sponsor_code=$refB)=1
  AND (SELECT COUNT(*) FROM nx_sponsorship WHERE user_id=@user_b AND sponsor_user_id=@user_a AND sponsor_code=$refA AND is_deleted=0)=1
  AND (SELECT COUNT(*) FROM nx_sponsorship WHERE user_id=@user_c AND sponsor_user_id=@user_b AND sponsor_code=$refB AND is_deleted=0)=1
  AND @user_a<>@user_b AND @user_b<>@user_c AND @user_a<>@user_c,
  1, 0
);
INSERT INTO l4_fixture_assert
SELECT IF(
  (SELECT COUNT(*) FROM nx_team_member WHERE id IN (@team_a0,@team_b0,@team_c0) AND user_id=member_user_id AND level=0 AND v_rank='V0' AND volume=0)=3
  AND (SELECT COUNT(*) FROM nx_team_member WHERE id IN (@team_ab,@team_bc) AND level=1 AND v_rank='V0' AND volume=0)=2
  AND (SELECT COUNT(*) FROM nx_team_member WHERE id IN (@team_a0,@team_b0,@team_c0,@team_ab,@team_bc) AND created_at=@fixture_ts AND updated_at=@fixture_ts)=5,
  1, 0
);
INSERT INTO l4_fixture_assert
SELECT IF(
  (SELECT COUNT(*) FROM nx_team_member existing
    WHERE existing.id NOT IN (@team_ab,@team_bc)
      AND existing.is_deleted=0
      AND existing.level BETWEEN 1 AND 2
      AND existing.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      AND (
        (
          CASE WHEN LENGTH(CAST(existing.member_user_id AS CHAR))<=4 THEN '***'
               ELSE CONCAT(LEFT(CAST(existing.member_user_id AS CHAR),2),'***',RIGHT(CAST(existing.member_user_id AS CHAR),2)) END
          =
          CASE WHEN LENGTH(CAST(@user_b AS CHAR))<=4 THEN '***'
               ELSE CONCAT(LEFT(CAST(@user_b AS CHAR),2),'***',RIGHT(CAST(@user_b AS CHAR),2)) END
          AND
          CASE WHEN LENGTH(CAST(existing.user_id AS CHAR))<=4 THEN '***'
               ELSE CONCAT(LEFT(CAST(existing.user_id AS CHAR),2),'***',RIGHT(CAST(existing.user_id AS CHAR),2)) END
          =
          CASE WHEN LENGTH(CAST(@user_a AS CHAR))<=4 THEN '***'
               ELSE CONCAT(LEFT(CAST(@user_a AS CHAR),2),'***',RIGHT(CAST(@user_a AS CHAR),2)) END
        ) OR (
          CASE WHEN LENGTH(CAST(existing.member_user_id AS CHAR))<=4 THEN '***'
               ELSE CONCAT(LEFT(CAST(existing.member_user_id AS CHAR),2),'***',RIGHT(CAST(existing.member_user_id AS CHAR),2)) END
          =
          CASE WHEN LENGTH(CAST(@user_c AS CHAR))<=4 THEN '***'
               ELSE CONCAT(LEFT(CAST(@user_c AS CHAR),2),'***',RIGHT(CAST(@user_c AS CHAR),2)) END
          AND
          CASE WHEN LENGTH(CAST(existing.user_id AS CHAR))<=4 THEN '***'
               ELSE CONCAT(LEFT(CAST(existing.user_id AS CHAR),2),'***',RIGHT(CAST(existing.user_id AS CHAR),2)) END
          =
          CASE WHEN LENGTH(CAST(@user_b AS CHAR))<=4 THEN '***'
               ELSE CONCAT(LEFT(CAST(@user_b AS CHAR),2),'***',RIGHT(CAST(@user_b AS CHAR),2)) END
        )
      )
  )=0,
  1, 0
);
COMMIT;

SELECT JSON_OBJECT(
  'fixtureTs', DATE_FORMAT(@fixture_ts, '%Y-%m-%dT%H:%i:%s'),
  'users', JSON_ARRAY(
    JSON_OBJECT('node','A','id',@user_a,'phone',$phoneA,'referralCode',$refA,'sponsorUserId',NULL,'sponsorCode',NULL),
    JSON_OBJECT('node','B','id',@user_b,'phone',$phoneB,'referralCode',$refB,'sponsorUserId',@user_a,'sponsorCode',$refA),
    JSON_OBJECT('node','C','id',@user_c,'phone',$phoneC,'referralCode',$refC,'sponsorUserId',@user_b,'sponsorCode',$refB)
  ),
  'kycProfiles', JSON_ARRAY(
    (SELECT JSON_OBJECT('id',id,'userId',user_id,'kycNo',kyc_no,'status',status,'triggerSource',trigger_source) FROM nx_kyc_profile WHERE user_id=@user_a),
    (SELECT JSON_OBJECT('id',id,'userId',user_id,'kycNo',kyc_no,'status',status,'triggerSource',trigger_source) FROM nx_kyc_profile WHERE user_id=@user_b),
    (SELECT JSON_OBJECT('id',id,'userId',user_id,'kycNo',kyc_no,'status',status,'triggerSource',trigger_source) FROM nx_kyc_profile WHERE user_id=@user_c)
  ),
  'sponsorships', JSON_ARRAY(
    JSON_OBJECT('edge','AB','id',@sponsor_b,'userId',@user_b,'sponsorUserId',@user_a,'sponsorCode',$refA),
    JSON_OBJECT('edge','BC','id',@sponsor_c,'userId',@user_c,'sponsorUserId',@user_b,'sponsorCode',$refB)
  ),
  'teamRows', JSON_ARRAY(
    JSON_OBJECT('edge','A0','id',@team_a0,'userId',@user_a,'memberUserId',@user_a,'memberNo',$memberA0,'level',0),
    JSON_OBJECT('edge','B0','id',@team_b0,'userId',@user_b,'memberUserId',@user_b,'memberNo',$memberB0,'level',0),
    JSON_OBJECT('edge','C0','id',@team_c0,'userId',@user_c,'memberUserId',@user_c,'memberNo',$memberC0,'level',0),
    JSON_OBJECT('edge','AB','id',@team_ab,'userId',@user_a,'memberUserId',@user_b,'memberNo',$memberAB,'level',1),
    JSON_OBJECT('edge','BC','id',@team_bc,'userId',@user_b,'memberUserId',@user_c,'memberNo',$memberBC,'level',1)
  ),
  'exportMasks', JSON_ARRAY(
    JSON_OBJECT(
      'edge','AB',
      'sponsor',CASE WHEN LENGTH(CAST(@user_a AS CHAR))<=4 THEN '***' ELSE CONCAT(LEFT(CAST(@user_a AS CHAR),2),'***',RIGHT(CAST(@user_a AS CHAR),2)) END,
      'member',CASE WHEN LENGTH(CAST(@user_b AS CHAR))<=4 THEN '***' ELSE CONCAT(LEFT(CAST(@user_b AS CHAR),2),'***',RIGHT(CAST(@user_b AS CHAR),2)) END
    ),
    JSON_OBJECT(
      'edge','BC',
      'sponsor',CASE WHEN LENGTH(CAST(@user_b AS CHAR))<=4 THEN '***' ELSE CONCAT(LEFT(CAST(@user_b AS CHAR),2),'***',RIGHT(CAST(@user_b AS CHAR),2)) END,
      'member',CASE WHEN LENGTH(CAST(@user_c AS CHAR))<=4 THEN '***' ELSE CONCAT(LEFT(CAST(@user_c AS CHAR),2),'***',RIGHT(CAST(@user_c AS CHAR),2)) END
    )
  )
);
"@
    $setupCommitted = $true
    $manifest = [ordered]@{
        fixtureLabel = $FixtureLabel
        runId = $RunId
        state = "COMMITTED"
        generatedAt = (Get-Date).ToString("o")
        database = $Database
        expectedCounts = $intent.expectedCounts
        candidate = $intent.candidate
        markers = $markers
        beforeTeamFingerprint = $beforeFingerprint
        fixtureTs = $created.fixtureTs
        users = @($created.users)
        kycProfiles = @($created.kycProfiles)
        sponsorships = @($created.sponsorships)
        teamRows = @($created.teamRows)
        exportMasks = @($created.exportMasks)
        topology = "A->B->C; level0 self loops plus level1 adjacency only; no level2 closure"
        publicPathClaimed = $false
        immutableAuditOutboxTouchedBySetup = $false
        cleanupContract = "caller must invoke l4-isolated-network-fixture-cleanup.ps1 from finally"
    }
    Write-AtomicJson $manifestPath $manifest
    $manifestHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $manifestPath).Hash
    Write-AtomicJson (Join-Path $resolvedEvidenceDir "fixture-setup-result.json") ([ordered]@{
        fixtureLabel = $FixtureLabel
        manifestPath = $manifestPath
        manifestSha256 = $manifestHash
        expectedExportFixtureRows = 2
        setupCommitted = $true
    })
    Write-Output $manifestPath
}
catch {
    if ($preflightConfirmed -and -not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        Invoke-ExactFallbackCleanup $markers $beforeFingerprint
    }
    throw
}
finally {
    # A successful setup intentionally keeps the fixture for the Owner window.
    # The caller owns the outer try/finally and must always invoke the dedicated
    # exact cleanup script. A failed setup without a durable manifest is cleaned
    # above by exact deterministic markers.
    if (-not $setupCommitted -and (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "fixture manifest exists but setup did not reach committed state"
    }
}
