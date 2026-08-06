[CmdletBinding()]
param(
    [string]$EvidenceRoot = 'D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\H\final3-owner'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not (Test-Path -LiteralPath $EvidenceRoot -PathType Container)) {
    throw "evidence root missing: $EvidenceRoot"
}
$manifestPath = Join-Path $EvidenceRoot 'SHA256SUMS.json'
$rootPath = [IO.Path]::GetFullPath($EvidenceRoot).TrimEnd('\') + '\'
$entries = @(
    Get-ChildItem -LiteralPath $EvidenceRoot -File -Recurse |
        Where-Object { $_.FullName -ne $manifestPath } |
        Sort-Object FullName |
        ForEach-Object {
            $relativePath = $_.FullName.Substring($rootPath.Length).Replace('\', '/')
            [ordered]@{
                relativePath = $relativePath
                bytes = $_.Length
                sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
            }
        }
)
if ($entries.Count -lt 1) {
    throw 'evidence manifest cannot be empty'
}
$manifest = [ordered]@{
    generatedAt = (Get-Date).ToString('o')
    evidenceRoot = $EvidenceRoot
    fileCount = $entries.Count
    entries = $entries
} | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText($manifestPath, [string]::Concat($manifest, [Environment]::NewLine))

[pscustomobject]@{
    ManifestPath = $manifestPath
    FileCount = $entries.Count
    Sha256 = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash
} | ConvertTo-Json -Compress
