param(
    [Parameter(Mandatory = $true)]
    [string]$ManifestPath,
    [Parameter(Mandatory = $true)]
    [string]$EvidenceDir,
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
$FixtureLabel = "验收夹具、非产品路径"
$Limit = 5000
$MaxRequestedDepth = 10

if (-not $env:MYSQL_PWD) {
    throw "MYSQL_PWD must be present in the process environment"
}
if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
    throw "fixture manifest not found: $ManifestPath"
}
if (-not (Test-Path -LiteralPath $MysqlExe -PathType Leaf)) {
    throw "mysql client not found: $MysqlExe"
}
if ((Get-Content -Raw -LiteralPath $PcBuildIdPath).Trim() -cne $ExpectedPcBuildId) {
    throw "PC BUILD_ID drifted before recursive DB proof"
}
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $BackendJarPath).Hash -cne
    $ExpectedBackendJarSha256.ToUpperInvariant()) {
    throw "backend jar hash drifted before recursive DB proof"
}
if (-not (Get-Process -Id $ExpectedPcPid -ErrorAction SilentlyContinue)) {
    throw "locked PC process is not running"
}
if (-not (Get-Process -Id $ExpectedBackendPid -ErrorAction SilentlyContinue)) {
    throw "locked backend process is not running"
}

$manifest = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json
if ($manifest.fixtureLabel -cne $FixtureLabel -or
    $manifest.runId -notmatch '^pc-full-acceptance-\d{8}-\d{6}$' -or
    $manifest.state -cne "COMMITTED" -or
    $manifest.database -cne $Database) {
    throw "fixture manifest identity/state/database mismatch"
}
$restrictedRoot = [System.IO.Path]::GetFullPath(
    "D:\workspace\bug-pic\.restricted\$($manifest.runId)\L\"
)
$resolvedEvidenceDir = [System.IO.Path]::GetFullPath($EvidenceDir)
if (-not $resolvedEvidenceDir.StartsWith($restrictedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "recursive DB proof evidence directory must stay under the restricted L Run directory"
}
New-Item -ItemType Directory -Path $resolvedEvidenceDir -Force | Out-Null

function Invoke-Mysql([string]$Sql) {
    $output = & $MysqlExe --batch --raw --skip-column-names -uroot -D $Database --execute $Sql
    if ($LASTEXITCODE -ne 0) {
        throw "mysql command failed"
    }
    return @($output)
}

function Invoke-Scalar([string]$Sql) {
    $lines = @(Invoke-Mysql $Sql | Where-Object { $_ -and $_.Trim() })
    if ($lines.Count -ne 1) {
        throw "mysql scalar query returned $($lines.Count) rows"
    }
    return [string]$lines[0]
}

function Invoke-JsonRows([string]$Sql) {
    $rows = @()
    foreach ($line in @(Invoke-Mysql $Sql)) {
        if ($line -and $line.Trim()) {
            $rows += ($line | ConvertFrom-Json)
        }
    }
    return @($rows)
}

function Assert-Equal($Actual, $Expected, [string]$Label) {
    if ([string]$Actual -cne [string]$Expected) {
        throw "$Label mismatch: expected=$Expected actual=$Actual"
    }
}

function Get-ProductionCte([int]$Depth) {
    return @"
WITH RECURSIVE tree_edges AS (
    SELECT m.user_id AS root_user_id,
           m.member_user_id,
           1 AS tree_depth,
           m.v_rank,
           m.volume,
           m.created_at AS joined_at,
           m.id AS edge_id,
           CAST(CONCAT(',', CAST(m.user_id AS CHAR), ',', CAST(m.member_user_id AS CHAR), ',') AS CHAR(4096)) AS visited_path
      FROM nx_team_member m
     WHERE m.is_deleted = 0
       AND m.level = 1
       AND m.user_id <> m.member_user_id
    UNION ALL
    SELECT t.root_user_id,
           c.member_user_id,
           t.tree_depth + 1,
           c.v_rank,
           c.volume,
           c.created_at,
           c.id,
           CONCAT(t.visited_path, CAST(c.member_user_id AS CHAR), ',')
      FROM tree_edges t
      JOIN nx_team_member c
        ON c.user_id = t.member_user_id
       AND c.level = 1
       AND c.is_deleted = 0
       AND c.user_id <> c.member_user_id
     WHERE t.tree_depth < $Depth
       AND LOCATE(CONCAT(',', CAST(c.member_user_id AS CHAR), ','), t.visited_path) = 0
),
ranked_edges AS (
    SELECT root_user_id,
           member_user_id,
           tree_depth,
           v_rank,
           volume,
           joined_at,
           edge_id,
           ROW_NUMBER() OVER (
             PARTITION BY root_user_id, member_user_id
             ORDER BY tree_depth ASC, joined_at ASC, edge_id ASC
           ) AS edge_rank
      FROM tree_edges
)
"@
}

function Get-ProductionRowsSql([int]$Depth, [string]$Period, [string]$RootFilter = "") {
    $filter = if ($RootFilter) { " AND root_user_id IN ($RootFilter)" } else { "" }
    return (Get-ProductionCte $Depth) + @"
SELECT JSON_OBJECT(
         'rootUserId', root_user_id,
         'memberUserId', member_user_id,
         'treeDepth', tree_depth,
         'vRank', COALESCE(NULLIF(v_rank, ''), 'UNRANKED'),
         'teamVolumeUsdt', COALESCE(volume, 0),
         'joinedAt', DATE_FORMAT(joined_at, '%Y-%m-%dT%H:%i:%s')
       )
  FROM ranked_edges
 WHERE edge_rank = 1
   AND joined_at >= CASE LOWER('$Period')
     WHEN 'day' THEN DATE_SUB(NOW(), INTERVAL 1 DAY)
     WHEN 'month' THEN DATE_SUB(NOW(), INTERVAL 30 DAY)
     ELSE DATE_SUB(NOW(), INTERVAL 7 DAY)
   END
$filter
 ORDER BY root_user_id ASC, tree_depth ASC, member_user_id ASC
 LIMIT $Limit
"@
}

$users = @($manifest.users)
$teamRows = @($manifest.teamRows)
if ($users.Count -ne 3 -or $teamRows.Count -ne 5) {
    throw "fixture manifest must contain exactly 3 users and 5 team rows"
}
$userByNode = @{}
foreach ($user in $users) {
    $userByNode[[string]$user.node] = $user
}
$teamByEdge = @{}
foreach ($row in $teamRows) {
    $teamByEdge[[string]$row.edge] = $row
}
foreach ($key in @("A", "B", "C")) {
    if (-not $userByNode.ContainsKey($key)) {
        throw "fixture manifest is missing user node $key"
    }
}
foreach ($key in @("A0", "B0", "C0", "AB", "BC")) {
    if (-not $teamByEdge.ContainsKey($key)) {
        throw "fixture manifest is missing team edge $key"
    }
}

$aId = [int64]$userByNode.A.id
$bId = [int64]$userByNode.B.id
$cId = [int64]$userByNode.C.id
$abId = [int64]$teamByEdge.AB.id
$bcId = [int64]$teamByEdge.BC.id
$rootFilter = "$aId,$bId,$cId"

$sourceIntegrity = Invoke-JsonRows @"
SELECT JSON_OBJECT(
  'users', (SELECT COUNT(*) FROM nx_user WHERE id IN ($rootFilter) AND is_deleted=0),
  'level0SelfLoops', (SELECT COUNT(*) FROM nx_team_member WHERE id IN ($([int64]$teamByEdge.A0.id),$([int64]$teamByEdge.B0.id),$([int64]$teamByEdge.C0.id)) AND level=0 AND user_id=member_user_id AND is_deleted=0),
  'level1Edges', (SELECT COUNT(*) FROM nx_team_member WHERE id IN ($abId,$bcId) AND level=1 AND user_id<>member_user_id AND is_deleted=0),
  'level2StoredRows', (SELECT COUNT(*) FROM nx_team_member WHERE user_id IN ($rootFilter) AND level=2 AND is_deleted=0)
)
"@
$source = $sourceIntegrity[0]
Assert-Equal $source.users 3 "fixture user count"
Assert-Equal $source.level0SelfLoops 3 "fixture level0 self-loop count"
Assert-Equal $source.level1Edges 2 "fixture level1 edge count"
Assert-Equal $source.level2StoredRows 0 "fixture stored level2 count"

$depth1Rows = @(Invoke-JsonRows (Get-ProductionRowsSql 1 "week" $rootFilter))
$depth2Rows = @(Invoke-JsonRows (Get-ProductionRowsSql 2 "week" $rootFilter))
$depth10Rows = @(Invoke-JsonRows (Get-ProductionRowsSql 10 "week" $rootFilter))
Assert-Equal $depth1Rows.Count 2 "depth1 fixture output count"
Assert-Equal $depth2Rows.Count 3 "depth2 fixture output count"
Assert-Equal $depth10Rows.Count 3 "depth10 fixture output count"

$depth1Pairs = @($depth1Rows | ForEach-Object {
    "$([int64]$_.rootUserId)>$([int64]$_.memberUserId):$([int]$_.treeDepth)"
} | Sort-Object)
$depth2Pairs = @($depth2Rows | ForEach-Object {
    "$([int64]$_.rootUserId)>$([int64]$_.memberUserId):$([int]$_.treeDepth)"
} | Sort-Object)
$expectedDepth1 = @("$aId>$bId`:1", "$bId>$cId`:1") | Sort-Object
$expectedDepth2 = @("$aId>$bId`:1", "$aId>$cId`:2", "$bId>$cId`:1") | Sort-Object
if (($depth1Pairs -join "|") -cne ($expectedDepth1 -join "|")) {
    throw "depth1 fixture edge set mismatch"
}
if (($depth2Pairs -join "|") -cne ($expectedDepth2 -join "|")) {
    throw "depth2 fixture edge set mismatch"
}
if (@($depth10Rows | Where-Object { [int64]$_.rootUserId -eq [int64]$_.memberUserId }).Count -ne 0) {
    throw "recursive output contains a self/cycle row"
}
if (@($depth10Rows | Group-Object { "$($_.rootUserId)>$($_.memberUserId)" } | Where-Object Count -gt 1).Count -ne 0) {
    throw "recursive output contains duplicate root/member rows"
}

# Read-only adversarial CTE: use the committed AB/BC rows, then add a virtual
# C->A cycle and an A->C direct alternative. Nothing is inserted into product
# tables. This exercises MySQL recursion, visited-path cycle rejection and
# ROW_NUMBER shortest-path de-duplication using the same algorithm as the mapper.
$adversarialRows = @(Invoke-JsonRows @"
WITH RECURSIVE source_edges AS (
    SELECT user_id, member_user_id, v_rank, volume, created_at, id AS edge_id
      FROM nx_team_member
     WHERE id IN ($abId,$bcId)
    UNION ALL
    SELECT $cId, $aId, 'V0', 0, NOW(), -1
    UNION ALL
    SELECT $aId, $cId, 'V0', 0, NOW(), -2
),
tree_edges AS (
    SELECT e.user_id AS root_user_id,
           e.member_user_id,
           1 AS tree_depth,
           e.created_at AS joined_at,
           e.edge_id,
           CAST(CONCAT(',', e.user_id, ',', e.member_user_id, ',') AS CHAR(4096)) AS visited_path
      FROM source_edges e
     WHERE e.user_id <> e.member_user_id
    UNION ALL
    SELECT t.root_user_id,
           c.member_user_id,
           t.tree_depth + 1,
           c.created_at,
           c.edge_id,
           CONCAT(t.visited_path, c.member_user_id, ',')
      FROM tree_edges t
      JOIN source_edges c ON c.user_id=t.member_user_id AND c.user_id<>c.member_user_id
     WHERE t.tree_depth < 10
       AND LOCATE(CONCAT(',', c.member_user_id, ','), t.visited_path)=0
),
ranked_edges AS (
    SELECT *,
           ROW_NUMBER() OVER (
             PARTITION BY root_user_id, member_user_id
             ORDER BY tree_depth, joined_at, edge_id
           ) AS edge_rank
      FROM tree_edges
)
SELECT JSON_OBJECT(
  'rawCount', COUNT(*),
  'rankedCount', SUM(CASE WHEN edge_rank=1 THEN 1 ELSE 0 END),
  'duplicateCandidates', SUM(CASE WHEN edge_rank>1 THEN 1 ELSE 0 END),
  'maxDepth', MAX(tree_depth),
  'selfRows', SUM(CASE WHEN root_user_id=member_user_id THEN 1 ELSE 0 END),
  'uniqueRankedPairs', COUNT(DISTINCT CASE WHEN edge_rank=1 THEN CONCAT(root_user_id,'>',member_user_id) END)
)
FROM ranked_edges
"@)
$adversarial = $adversarialRows[0]
Assert-Equal $adversarial.rawCount 7 "adversarial raw recursion count"
Assert-Equal $adversarial.rankedCount 6 "adversarial ranked output count"
Assert-Equal $adversarial.duplicateCandidates 1 "adversarial multi-path candidate count"
Assert-Equal $adversarial.maxDepth 2 "adversarial maximum depth"
Assert-Equal $adversarial.selfRows 0 "adversarial self/cycle output count"
Assert-Equal $adversarial.uniqueRankedPairs 6 "adversarial unique ranked pair count"

# The mapper intentionally applies the rolling window after recursion/ranking.
# A virtual old A->B anchor plus recent B->C child therefore excludes A->B but
# retains A->C(depth2) and B->C(depth1). This is a read-only SQL carrier.
$windowRows = @(Invoke-JsonRows @"
WITH RECURSIVE source_edges AS (
    SELECT $aId AS user_id, $bId AS member_user_id, DATE_SUB(NOW(), INTERVAL 40 DAY) AS joined_at, 1 AS edge_id
    UNION ALL
    SELECT $bId, $cId, NOW(), 2
),
tree_edges AS (
    SELECT user_id AS root_user_id,
           member_user_id,
           1 AS tree_depth,
           joined_at,
           edge_id,
           CAST(CONCAT(',', user_id, ',', member_user_id, ',') AS CHAR(4096)) AS visited_path
      FROM source_edges
    UNION ALL
    SELECT t.root_user_id,
           c.member_user_id,
           t.tree_depth + 1,
           c.joined_at,
           c.edge_id,
           CONCAT(t.visited_path, c.member_user_id, ',')
      FROM tree_edges t
      JOIN source_edges c ON c.user_id=t.member_user_id
     WHERE t.tree_depth < 2
       AND LOCATE(CONCAT(',', c.member_user_id, ','), t.visited_path)=0
),
ranked_edges AS (
    SELECT *,
           ROW_NUMBER() OVER (
             PARTITION BY root_user_id, member_user_id
             ORDER BY tree_depth, joined_at, edge_id
           ) AS edge_rank
      FROM tree_edges
)
SELECT JSON_OBJECT('rootUserId',root_user_id,'memberUserId',member_user_id,'treeDepth',tree_depth)
  FROM ranked_edges
 WHERE edge_rank=1
   AND joined_at>=DATE_SUB(NOW(), INTERVAL 7 DAY)
 ORDER BY root_user_id,tree_depth,member_user_id
"@)
$windowPairs = @($windowRows | ForEach-Object {
    "$([int64]$_.rootUserId)>$([int64]$_.memberUserId):$([int]$_.treeDepth)"
} | Sort-Object)
$expectedWindowPairs = @("$aId>$cId`:2", "$bId>$cId`:1") | Sort-Object
if (($windowPairs -join "|") -cne ($expectedWindowPairs -join "|")) {
    throw "final-output rolling-window semantics mismatch"
}

$globalWeekRows = @(Invoke-JsonRows (Get-ProductionRowsSql 10 "week"))
$globalMonthRows = @(Invoke-JsonRows (Get-ProductionRowsSql 10 "month"))
if ($globalMonthRows.Count -lt $globalWeekRows.Count) {
    throw "month window unexpectedly returned fewer rows than week"
}

$explainQuery = (Get-ProductionCte 10) + @"
SELECT root_user_id,member_user_id,tree_depth,v_rank,volume,joined_at
  FROM ranked_edges
 WHERE edge_rank=1
   AND joined_at>=DATE_SUB(NOW(), INTERVAL 30 DAY)
 ORDER BY root_user_id,tree_depth,member_user_id
 LIMIT $Limit
"@
$explainJsonText = (@(Invoke-Mysql ("EXPLAIN FORMAT=JSON " + $explainQuery)) -join [Environment]::NewLine)
$explainAnalyzeText = (@(Invoke-Mysql ("EXPLAIN ANALYZE " + $explainQuery)) -join [Environment]::NewLine)
if (-not $explainJsonText -or -not $explainAnalyzeText) {
    throw "EXPLAIN evidence is empty"
}
$explainJsonPath = Join-Path $resolvedEvidenceDir "explain-format-json.txt"
$explainAnalyzePath = Join-Path $resolvedEvidenceDir "explain-analyze.txt"
$explainJsonText | Set-Content -LiteralPath $explainJsonPath -Encoding utf8 -NoNewline
$explainAnalyzeText | Set-Content -LiteralPath $explainAnalyzePath -Encoding utf8 -NoNewline

$capacityDurations = @()
$capacityCount = 0
$capacitySql = (Get-ProductionCte 10) + @"
SELECT COUNT(*)
FROM (
    SELECT root_user_id,member_user_id
      FROM ranked_edges
     WHERE edge_rank=1
       AND joined_at>=DATE_SUB(NOW(), INTERVAL 30 DAY)
     ORDER BY root_user_id,tree_depth,member_user_id
     LIMIT $Limit
) bounded
"@
foreach ($iteration in 1..5) {
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $capacityCount = [int](Invoke-Scalar $capacitySql)
    $stopwatch.Stop()
    $capacityDurations += [math]::Round($stopwatch.Elapsed.TotalMilliseconds, 3)
}
if ($capacityCount -gt $Limit) {
    throw "capacity query exceeded the API limit"
}
$cteMaxRecursionDepth = [int](Invoke-Scalar "SELECT @@SESSION.cte_max_recursion_depth")
if ($cteMaxRecursionDepth -lt $MaxRequestedDepth) {
    throw "MySQL cte_max_recursion_depth is below the API maximum depth"
}
$worstCaseVisitedPathChars = 1 + (($MaxRequestedDepth + 1) * (19 + 1))
if ($worstCaseVisitedPathChars -ge 4096) {
    throw "visited path capacity is insufficient"
}

$result = [ordered]@{
    fixtureLabel = $FixtureLabel
    generatedAt = (Get-Date).ToString("o")
    manifestPath = $ManifestPath
    manifestSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $ManifestPath).Hash
    candidate = [ordered]@{
        pcBuildId = $ExpectedPcBuildId
        pcPid = $ExpectedPcPid
        backendPid = $ExpectedBackendPid
        backendJarSha256 = $ExpectedBackendJarSha256.ToUpperInvariant()
    }
    sourceIntegrity = $source
    productionFixtureProof = [ordered]@{
        depth1Rows = $depth1Rows
        depth2Rows = $depth2Rows
        depth10Rows = $depth10Rows
        depth1Pairs = $depth1Pairs
        depth2Pairs = $depth2Pairs
        aToCExpandedAtDepth2 = $true
        noCycleOrSelfOutput = $true
        noDuplicateOutputPairs = $true
    }
    readOnlyAdversarialCte = [ordered]@{
        label = "read-only MySQL CTE, no product-table writes"
        virtualEdges = @("C->A cycle", "A->C direct alternate path")
        result = $adversarial
        cycleRejected = $true
        multiPathDeduplicatedToShortestStableRow = $true
    }
    finalOutputWindowProbe = [ordered]@{
        label = "read-only MySQL CTE, no product-table writes"
        rows = $windowRows
        oldAnchorExcluded = $true
        recentDescendantIncluded = $true
        globalWeekRowCount = $globalWeekRows.Count
        globalMonthRowCount = $globalMonthRows.Count
    }
    explain = [ordered]@{
        formatJsonPath = $explainJsonPath
        formatJsonSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $explainJsonPath).Hash
        analyzePath = $explainAnalyzePath
        analyzeSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $explainAnalyzePath).Hash
    }
    capacity = [ordered]@{
        apiLimit = $Limit
        requestedDepth = $MaxRequestedDepth
        cteMaxRecursionDepth = $cteMaxRecursionDepth
        resultRowCount = $capacityCount
        fiveRunDurationMs = $capacityDurations
        maxDurationMs = ($capacityDurations | Measure-Object -Maximum).Maximum
        visitedPathCapacityChars = 4096
        worstCaseBigintPathCharsAtDepth10 = $worstCaseVisitedPathChars
        withinLimit = $true
    }
    proofPassed = $true
}
$resultPath = Join-Path $resolvedEvidenceDir "recursive-db-proof.json"
$result | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $resultPath -Encoding utf8 -NoNewline
$resultHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $resultPath).Hash
Write-Output (ConvertTo-Json ([ordered]@{
    proofPassed = $true
    resultPath = $resultPath
    resultSha256 = $resultHash
    depth1Rows = $depth1Rows.Count
    depth2Rows = $depth2Rows.Count
    adversarial = $adversarial
    capacity = $result.capacity
}) -Depth 12)
