param(
    [Parameter(Mandatory = $true)]
    [string[]]$ManifestPath,
    [Parameter(Mandatory = $true)]
    [string]$EvidenceDir,
    [string]$Database = "nexion_acceptance_20260729_114336",
    [string]$MysqlExe = "D:\software\MySQL\MySQL Server 8.0\bin\mysql.exe",
    [string]$McExe = "D:\software\MinIO\bin\mc.exe",
    [string]$McAlias = "local",
    [string]$Bucket = "nexion-acceptance-20260729-114336"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $env:MYSQL_PWD) {
    throw "MYSQL_PWD must be present in the process environment"
}
if (-not (Test-Path -LiteralPath $MysqlExe -PathType Leaf)) {
    throw "mysql client not found: $MysqlExe"
}
if (-not (Test-Path -LiteralPath $McExe -PathType Leaf)) {
    throw "MinIO client not found: $McExe"
}

New-Item -ItemType Directory -Path $EvidenceDir -Force | Out-Null
$reportById = @{}
$idempotencyByPair = @{}
$l2PayloadByReport = @{}
$l6Evidence = $null

foreach ($item in $ManifestPath) {
    if (-not (Test-Path -LiteralPath $item -PathType Leaf)) {
        throw "manifest not found: $item"
    }
    $manifest = Get-Content -Raw -LiteralPath $item | ConvertFrom-Json
    $reportsProperty = $manifest.PSObject.Properties["reports"]
    $reports = if ($reportsProperty) { @($reportsProperty.Value) } else { @() }
    foreach ($report in $reports) {
        if ($null -eq $report -or -not $report.reportId) {
            continue
        }
        $reportId = [string]$report.reportId
        $reportById[$reportId] = [pscustomobject]@{
            reportId = $reportId
            module = [string]$report.module
            objectKey = [string]$report.objectKey
        }
    }
    $idempotencyProperty = $manifest.PSObject.Properties["idempotency"]
    $idempotencyRecords = if ($idempotencyProperty) { @($idempotencyProperty.Value) } else { @() }
    foreach ($record in $idempotencyRecords) {
        if ($null -eq $record -or -not $record.scope -or -not $record.key) {
            continue
        }
        $pair = "$($record.scope)`n$($record.key)"
        $idempotencyByPair[$pair] = [pscustomobject]@{
            scope = [string]$record.scope
            key = [string]$record.key
        }
    }
    $cleanupProperty = $manifest.PSObject.Properties["cleanup"]
    $cleanup = if ($cleanupProperty) { $cleanupProperty.Value } else { $null }
    if ($cleanup -and $cleanup.PSObject.Properties["reportId"] -and $cleanup.reportId) {
        $reportId = [string]$cleanup.reportId
        $objectKey = if ($cleanup.PSObject.Properties["minioObject"] -and $cleanup.minioObject) {
            [string]$cleanup.minioObject
        } else {
            "bi-reports/$($reportId.ToLowerInvariant()).csv"
        }
        $reportById[$reportId] = [pscustomobject]@{
            reportId = $reportId
            module = "L3"
            objectKey = $objectKey
        }
        $cleanupIdempotencyProperty = $cleanup.PSObject.Properties["idempotency"]
        $cleanupIdempotency = if ($cleanupIdempotencyProperty) {
            @($cleanupIdempotencyProperty.Value)
        } else {
            @()
        }
        foreach ($record in $cleanupIdempotency) {
            if ($null -eq $record -or -not $record.scope -or -not $record.key) {
                continue
            }
            $pair = "$($record.scope)`n$($record.key)"
            $idempotencyByPair[$pair] = [pscustomobject]@{
                scope = [string]$record.scope
                key = [string]$record.key
            }
        }
    }
    $l2Property = $manifest.PSObject.Properties["l2"]
    $l2 = if ($l2Property) { $l2Property.Value } else { $null }
    $hasL2Payload = $l2 `
        -and $l2.PSObject.Properties["reportId"] `
        -and $l2.PSObject.Properties["artifactPayload"] `
        -and $l2.reportId `
        -and $l2.artifactPayload.PSObject.Properties["path"] `
        -and $l2.artifactPayload.path
    if ($hasL2Payload) {
        $l2PayloadByReport[[string]$l2.reportId] = [string]$l2.artifactPayload.path
    }
    $baselineProperty = $manifest.PSObject.Properties["databaseBaseline"]
    $actorProperty = $manifest.PSObject.Properties["actor"]
    $l6Property = $manifest.PSObject.Properties["l6"]
    if ($l6Property -and $baselineProperty -and $actorProperty) {
        $l6 = $l6Property.Value
        if ($l6 -and $l6.PSObject.Properties["activityRows"]) {
            $l6Evidence = [pscustomobject]@{
                actor = [string]$actorProperty.Value
                auditBaselineId = [int64]$baselineProperty.Value.auditId
                outboxBaselineId = [int64]$baselineProperty.Value.outboxId
                activityRows = [int64]$l6.activityRows
            }
        }
    }
}

foreach ($report in $reportById.Values) {
    if ($report.reportId -notmatch '^[A-Za-z0-9._:-]+$') {
        throw "unsafe report id in manifest: $($report.reportId)"
    }
    if ($report.objectKey -notmatch '^bi-reports/[a-z0-9._:-]+\.csv$') {
        throw "unsafe MinIO object key in manifest: $($report.objectKey)"
    }
}
foreach ($record in $idempotencyByPair.Values) {
    if ($record.scope -notmatch '^[A-Za-z0-9._:-]+$') {
        throw "unsafe idempotency scope in manifest: $($record.scope)"
    }
    if ($record.key -notmatch '^[A-Za-z0-9._:-]+$') {
        throw "unsafe idempotency key in manifest: $($record.key)"
    }
}

function ConvertTo-SqlLiteral([string]$Value) {
    return "'" + $Value.Replace("'", "''") + "'"
}

function Invoke-Mysql([string]$Sql) {
    $output = & $MysqlExe -uroot -N -B -D $Database -e $Sql
    if ($LASTEXITCODE -ne 0) {
        throw "mysql command failed"
    }
    return @($output)
}

function Invoke-JsonRow([string]$Sql) {
    $lines = @(Invoke-Mysql $Sql)
    if ($lines.Count -eq 0 -or -not $lines[0]) {
        return $null
    }
    return $lines[0] | ConvertFrom-Json
}

function Invoke-Count([string]$Sql) {
    $lines = @(Invoke-Mysql $Sql)
    if ($lines.Count -eq 0) {
        return 0
    }
    return [int64]$lines[0]
}

$pre = [ordered]@{
    generatedAt = (Get-Date).ToString("o")
    database = $Database
    bucket = $Bucket
    reports = @()
    idempotency = @()
    l6ImmutableExport = $null
    reconciliationPassed = $false
    reconciliationError = $null
}
$post = [ordered]@{
    generatedAt = $null
    reports = @()
    idempotency = @()
    immutableEvidenceRetained = $true
    cleanupPassed = $false
    cleanupError = $null
}
$reconciliationError = $null
$cleanupError = $null

try {
    foreach ($report in $reportById.Values) {
        $id = ConvertTo-SqlLiteral $report.reportId
        $row = Invoke-JsonRow @"
SELECT JSON_OBJECT(
  'reportId', r.report_id,
  'moduleCode', r.module_code,
  'reportType', r.report_type,
  'rowCount', r.row_count,
  'status', r.status,
  'artifactCount', COUNT(DISTINCT a.report_id),
  'artifactObjectKey', MAX(a.object_key),
  'artifactSizeBytes', MAX(a.size_bytes),
  'artifactSha256', MAX(a.content_sha256)
)
FROM nx_admin_fourth_batch_report r
LEFT JOIN nx_bi_report_artifact a ON a.report_id=r.report_id
WHERE r.report_id=$id AND r.is_deleted=0
GROUP BY r.report_id, r.module_code, r.report_type, r.row_count, r.status
"@
        if ($null -eq $row) {
            throw "report row missing: $($report.reportId)"
        }
        # Governed BI exports created through MybatisBiReportRepository are
        # persisted in the L5 report registry. This includes aggregate EXP-*
        # reports and the dedicated L4TREE-* producer.
        $expectedModule = if (
            [string]$report.reportId -like "EXP-*" -or
            [string]$report.reportId -like "L4TREE-*"
        ) {
            "L5"
        } else {
            ([string]$report.module).Split("_")[0]
        }
        if ([string]$row.moduleCode -ne $expectedModule) {
            throw "report module mismatch: $($report.reportId)"
        }
        if ([string]$row.status -ne "READY" -or [int64]$row.rowCount -lt 1) {
            throw "report is not a non-empty READY snapshot: $($report.reportId)"
        }
        if ([int64]$row.artifactCount -ne 1) {
            throw "artifact row count is not 1: $($report.reportId)"
        }
        if ([string]$row.artifactObjectKey -ne [string]$report.objectKey) {
            throw "artifact object key mismatch: $($report.reportId)"
        }

        $auditCount = Invoke-Count @"
SELECT COUNT(*)
FROM nx_audit_log
WHERE is_deleted=0
  AND (
    resource_id=$id
    OR biz_no=$id
    OR JSON_UNQUOTE(JSON_EXTRACT(detail_json, '$.reportId'))=$id
  )
"@
        if ($auditCount -lt 1) {
            throw "A2 audit evidence missing: $($report.reportId)"
        }

        $event = Invoke-JsonRow @"
SELECT JSON_OBJECT(
  'count', COUNT(*),
  'revision302Count', SUM(CASE WHEN schema_revision=302 AND schema_registered=1 THEN 1 ELSE 0 END),
  'rowCount', MAX(CAST(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.rowCount')) AS UNSIGNED)),
  'artifactStore', MAX(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.artifactStore'))),
  'artifactSha256', MAX(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.artifactSha256'))),
  'artifactSizeBytes', MAX(CAST(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.artifactSizeBytes')) AS UNSIGNED))
)
FROM nx_event_outbox
WHERE is_deleted=0
  AND event_type='admin.report_exported'
  AND (
    aggregate_id=$id
    OR JSON_UNQUOTE(JSON_EXTRACT(payload, '$.reportId'))=$id
  )
"@
        if ([int64]$event.count -ne 1 -or [int64]$event.revision302Count -ne 1) {
            throw "A4 admin.report_exported revision 302 evidence is not exactly one: $($report.reportId)"
        }
        if ([int64]$event.rowCount -ne [int64]$row.rowCount) {
            throw "A4 rowCount mismatch: $($report.reportId)"
        }
        $requiresArtifactBinding = @("L1", "L2", "L4_AGG") -contains [string]$report.module
        $hasArtifactBinding = [string]$event.artifactStore -eq "MINIO" `
            -and [string]$event.artifactSha256 `
            -and $null -ne $event.artifactSizeBytes
        if ($requiresArtifactBinding -and -not $hasArtifactBinding) {
            throw "A4 optional artifact binding is required for this producer: $($report.reportId)"
        }
        if ($hasArtifactBinding) {
            if ([string]$event.artifactSha256 -ne [string]$row.artifactSha256) {
                throw "A4 artifactSha256 mismatch: $($report.reportId)"
            }
            if ([int64]$event.artifactSizeBytes -ne [int64]$row.artifactSizeBytes) {
                throw "A4 artifactSizeBytes mismatch: $($report.reportId)"
            }
        }

        $tempFile = [System.IO.Path]::GetTempFileName()
        try {
            & $McExe cp --quiet "$McAlias/$Bucket/$($report.objectKey)" $tempFile
            if ($LASTEXITCODE -ne 0) {
                throw "MinIO object missing: $($report.objectKey)"
            }
            $minioSize = (Get-Item -LiteralPath $tempFile).Length
            $minioSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $tempFile).Hash.ToUpperInvariant()
            if ($minioSize -ne [int64]$row.artifactSizeBytes) {
                throw "MinIO size mismatch: $($report.reportId)"
            }
            if ($minioSha -ne ([string]$row.artifactSha256).ToUpperInvariant()) {
                throw "MinIO SHA-256 mismatch: $($report.reportId)"
            }
            if ($l2PayloadByReport.ContainsKey($report.reportId)) {
                $payloadPath = [string]$l2PayloadByReport[$report.reportId]
                if (-not (Test-Path -LiteralPath $payloadPath -PathType Leaf)) {
                    throw "L2 local payload evidence missing: $payloadPath"
                }
                $localSize = (Get-Item -LiteralPath $payloadPath).Length
                $localSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $payloadPath).Hash.ToUpperInvariant()
                if ($localSize -ne $minioSize -or $localSha -ne $minioSha) {
                    throw "L2 local payload, DB artifact and MinIO object are not the same bytes"
                }
            }
        } finally {
            Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
        }

        $pre.reports += [ordered]@{
            module = $report.module
            reportId = $report.reportId
            reportType = $row.reportType
            rowCount = [int64]$row.rowCount
            status = $row.status
            artifactObjectKey = $row.artifactObjectKey
            artifactSizeBytes = [int64]$row.artifactSizeBytes
            artifactSha256 = $row.artifactSha256
            auditCount = $auditCount
            eventCount = [int64]$event.count
            eventRevision302Count = [int64]$event.revision302Count
            eventRowCount = [int64]$event.rowCount
            eventArtifactStore = $event.artifactStore
            eventArtifactBindingRequired = $requiresArtifactBinding
            eventArtifactBindingPresent = $hasArtifactBinding
        }
    }

    foreach ($record in $idempotencyByPair.Values) {
        $scope = ConvertTo-SqlLiteral $record.scope
        $key = ConvertTo-SqlLiteral $record.key
        $count = Invoke-Count "SELECT COUNT(*) FROM nx_admin_idempotency_record WHERE scope=$scope AND idempotency_key=$key AND is_deleted=0"
        $pre.idempotency += [ordered]@{ scope = $record.scope; key = $record.key; count = $count }
        if ($count -gt 1) {
            throw "duplicate idempotency rows: $($record.scope) / $($record.key)"
        }
    }
    if ($l6Evidence) {
        if ($l6Evidence.auditBaselineId -lt 1 -or $l6Evidence.outboxBaselineId -lt 1) {
            throw "L6 immutable evidence baselines must be positive"
        }
        $actor = ConvertTo-SqlLiteral $l6Evidence.actor
        $eventCount = Invoke-Count @"
SELECT COUNT(*)
FROM nx_event_outbox
WHERE id > $($l6Evidence.outboxBaselineId)
  AND is_deleted=0
  AND event_type='admin.report_exported'
  AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.exportType'))='BEHAVIOR_AGGREGATE'
  AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.operator'))=$actor
"@
        if ($eventCount -ne 1) {
            throw "L6 immutable A4 event count is not exactly one after baseline"
        }
        $event = Invoke-JsonRow @"
SELECT JSON_OBJECT(
  'eventId', event_id,
  'aggregateId', aggregate_id,
  'rowCount', CAST(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.rowCount')) AS UNSIGNED),
  'revision', schema_revision,
  'registered', schema_registered,
  'artifactStore', JSON_UNQUOTE(JSON_EXTRACT(payload, '$.artifactStore')),
  'artifactSha256', JSON_UNQUOTE(JSON_EXTRACT(payload, '$.artifactSha256')),
  'artifactSizeBytes', JSON_UNQUOTE(JSON_EXTRACT(payload, '$.artifactSizeBytes'))
)
FROM nx_event_outbox
WHERE id > $($l6Evidence.outboxBaselineId)
  AND is_deleted=0
  AND event_type='admin.report_exported'
  AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.exportType'))='BEHAVIOR_AGGREGATE'
  AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.operator'))=$actor
ORDER BY id
LIMIT 1
"@
        if ([int64]$event.revision -ne 302 -or [int64]$event.registered -ne 1) {
            throw "L6 A4 event is not registered revision 302"
        }
        if ([int64]$event.rowCount -ne [int64]$l6Evidence.activityRows) {
            throw "L6 visible activity rows and A4 event rowCount differ"
        }
        if ($event.artifactStore -or $event.artifactSha256 -or $event.artifactSizeBytes) {
            throw "L6 direct aggregate export must not claim a persisted MinIO artifact"
        }
        $exportId = ConvertTo-SqlLiteral ([string]$event.aggregateId)
        $auditCount = Invoke-Count @"
SELECT COUNT(*)
FROM nx_audit_log
WHERE id > $($l6Evidence.auditBaselineId)
  AND is_deleted=0
  AND action='admin.report_exported'
  AND resource_type='BI_BEHAVIOR_AGGREGATE'
  AND resource_id=$exportId
  AND actor_username=$actor
"@
        if ($auditCount -ne 1) {
            throw "L6 immutable A2 audit count is not exactly one after baseline"
        }
        $mutableCount = Invoke-Count @"
SELECT
  (SELECT COUNT(*) FROM nx_admin_fourth_batch_report WHERE report_id=$exportId)
  + (SELECT COUNT(*) FROM nx_bi_report_artifact WHERE report_id=$exportId)
  + (SELECT COUNT(*) FROM nx_bi_report_download_grant WHERE report_id=$exportId)
"@
        if ($mutableCount -ne 0) {
            throw "L6 direct aggregate export unexpectedly created mutable report artifacts"
        }
        $pre.l6ImmutableExport = [ordered]@{
            exportId = $event.aggregateId
            eventId = $event.eventId
            rowCount = [int64]$event.rowCount
            eventRevision = [int64]$event.revision
            eventRegistered = [int64]$event.registered
            auditCount = $auditCount
            mutableRowCount = $mutableCount
            artifactFieldsAbsent = $true
        }
    }
    $pre.reconciliationPassed = $true
} catch {
    $reconciliationError = $_.Exception.Message
    $pre.reconciliationError = $reconciliationError
} finally {
    try {
        foreach ($report in $reportById.Values) {
            $id = ConvertTo-SqlLiteral $report.reportId
            Invoke-Mysql "DELETE FROM nx_bi_report_download_grant WHERE report_id=$id" | Out-Null
            Invoke-Mysql "DELETE FROM nx_bi_report_artifact WHERE report_id=$id" | Out-Null
            Invoke-Mysql "DELETE FROM nx_admin_fourth_batch_report WHERE report_id=$id" | Out-Null
            & $McExe rm --force "$McAlias/$Bucket/$($report.objectKey)" | Out-Null
            if ($LASTEXITCODE -ne 0) {
                throw "MinIO cleanup failed: $($report.objectKey)"
            }
            & $McExe stat "$McAlias/$Bucket/$($report.objectKey)" 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) {
                throw "MinIO object residue remains: $($report.objectKey)"
            }
        }
        foreach ($record in $idempotencyByPair.Values) {
            $scope = ConvertTo-SqlLiteral $record.scope
            $key = ConvertTo-SqlLiteral $record.key
            Invoke-Mysql "DELETE FROM nx_admin_idempotency_record WHERE scope=$scope AND idempotency_key=$key" | Out-Null
        }
        foreach ($report in $reportById.Values) {
            $id = ConvertTo-SqlLiteral $report.reportId
            $mutableCount = Invoke-Count @"
SELECT
  (SELECT COUNT(*) FROM nx_bi_report_download_grant WHERE report_id=$id)
  + (SELECT COUNT(*) FROM nx_bi_report_artifact WHERE report_id=$id)
  + (SELECT COUNT(*) FROM nx_admin_fourth_batch_report WHERE report_id=$id)
"@
            $auditCount = Invoke-Count "SELECT COUNT(*) FROM nx_audit_log WHERE is_deleted=0 AND (resource_id=$id OR biz_no=$id OR JSON_UNQUOTE(JSON_EXTRACT(detail_json, '$.reportId'))=$id)"
            $eventCount = Invoke-Count "SELECT COUNT(*) FROM nx_event_outbox WHERE is_deleted=0 AND event_type='admin.report_exported' AND (aggregate_id=$id OR JSON_UNQUOTE(JSON_EXTRACT(payload, '$.reportId'))=$id)"
            $post.reports += [ordered]@{
                reportId = $report.reportId
                mutableRowCount = $mutableCount
                minioObjectAbsent = $true
                retainedAuditCount = $auditCount
                retainedEventCount = $eventCount
            }
            if ($mutableCount -ne 0) {
                throw "mutable report residue remains: $($report.reportId)"
            }
        }
        foreach ($record in $idempotencyByPair.Values) {
            $scope = ConvertTo-SqlLiteral $record.scope
            $key = ConvertTo-SqlLiteral $record.key
            $count = Invoke-Count "SELECT COUNT(*) FROM nx_admin_idempotency_record WHERE scope=$scope AND idempotency_key=$key"
            $post.idempotency += [ordered]@{ scope = $record.scope; key = $record.key; count = $count }
            if ($count -ne 0) {
                throw "idempotency residue remains: $($record.scope) / $($record.key)"
            }
        }
        $post.cleanupPassed = $true
    } catch {
        $cleanupError = $_.Exception.Message
        $post.cleanupError = $cleanupError
    }
    $post.generatedAt = (Get-Date).ToString("o")
    $pre | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $EvidenceDir "db-a2-a4-minio-pre-cleanup.json") -Encoding utf8
    $post | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $EvidenceDir "exact-cleanup-result.json") -Encoding utf8
}

if ($cleanupError) {
    throw $cleanupError
}
if ($reconciliationError) {
    throw $reconciliationError
}
