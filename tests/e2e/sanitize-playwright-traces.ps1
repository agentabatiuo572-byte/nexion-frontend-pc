param(
  [Parameter(Mandatory = $true)]
  [string]$EvidenceRoot,
  [string[]]$LiteralSecrets = @()
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Protect-Text([string]$Value) {
  if ($null -eq $Value) { return $Value }
  $next = $Value
  $next = [regex]::Replace($next, '(?i)(Bearer\s+)[A-Za-z0-9._~+/=-]+', '$1[REDACTED]')
  $next = [regex]::Replace($next, 'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[REDACTED_JWT]')
  $next = [regex]::Replace(
    $next,
    '(?i)("(?:password|authorization|cookie|set-cookie|access[_-]?token|refresh[_-]?token|token)"\s*:\s*")[^"]*(")',
    '$1[REDACTED]$2')
  $next = [regex]::Replace(
    $next,
    '(?i)("name"\s*:\s*"(?:authorization|cookie|set-cookie)"\s*,\s*"value"\s*:\s*")[^"]*(")',
    '$1[REDACTED]$2')
  foreach ($secret in $LiteralSecrets) {
    if (-not [string]::IsNullOrWhiteSpace($secret)) {
      $next = $next.Replace($secret, '[REDACTED]')
    }
  }
  return $next
}

function Protect-Node($Node) {
  if ($null -eq $Node) { return }
  if ($Node -is [System.Collections.IList]) {
    foreach ($item in $Node) { Protect-Node $item }
    return
  }
  if ($Node -isnot [pscustomobject]) { return }

  $properties = @($Node.PSObject.Properties)
  $passwordContext = $false
  $selector = $Node.PSObject.Properties['selector']
  if ($selector -and [string]$selector.Value -match '(?i)password|密码|type=.?password') {
    $passwordContext = $true
  }
  $type = $Node.PSObject.Properties['type']
  if ($type -and [string]$type.Value -match '^(?i:password)$') {
    $passwordContext = $true
  }

  foreach ($property in $properties) {
    $name = $property.Name
    if ($name -match '^(?i:password|authorization|cookie|set-cookie|access[_-]?token|refresh[_-]?token|token)$') {
      $property.Value = '[REDACTED]'
      continue
    }
    if ($name -match '^(?i:postData|text|value|expectedValue|expectedText)$' -and $passwordContext) {
      $property.Value = '[REDACTED]'
      continue
    }
    if ($property.Value -is [string]) {
      $property.Value = Protect-Text ([string]$property.Value)
    } else {
      Protect-Node $property.Value
    }
  }

  $headerName = $Node.PSObject.Properties['name']
  $headerValue = $Node.PSObject.Properties['value']
  if ($headerName -and $headerValue -and [string]$headerName.Value -match '^(?i:authorization|cookie|set-cookie)$') {
    $headerValue.Value = '[REDACTED]'
  }
}

function Protect-JsonLines([string]$Path) {
  $lines = [System.IO.File]::ReadAllLines($Path)
  $output = [System.Collections.Generic.List[string]]::new()
  foreach ($line in $lines) {
    if ([string]::IsNullOrWhiteSpace($line)) {
      $output.Add($line)
      continue
    }
    try {
      $node = $line | ConvertFrom-Json -Depth 100
      Protect-Node $node
      $output.Add(($node | ConvertTo-Json -Depth 100 -Compress))
    } catch {
      $output.Add((Protect-Text $line))
    }
  }
  [System.IO.File]::WriteAllLines($Path, $output, [System.Text.UTF8Encoding]::new($false))
}

$root = (Resolve-Path -LiteralPath $EvidenceRoot).Path
$archives = Get-ChildItem -LiteralPath $root -Recurse -File -Filter '*.zip'
foreach ($archive in $archives) {
  $temp = Join-Path ([System.IO.Path]::GetTempPath()) ("nexion-trace-redact-" + [guid]::NewGuid().ToString('N'))
  $replacement = "$($archive.FullName).sanitized"
  try {
    [System.IO.Compression.ZipFile]::ExtractToDirectory($archive.FullName, $temp)
    Get-ChildItem -LiteralPath $temp -Recurse -File | ForEach-Object {
      if ($_.Extension -in @('.trace', '.network', '.stacks', '.json', '.md', '.txt')) {
        Protect-JsonLines $_.FullName
      }
    }
    [System.IO.Compression.ZipFile]::CreateFromDirectory($temp, $replacement)
    Move-Item -LiteralPath $replacement -Destination $archive.FullName -Force
  } finally {
    if (Test-Path -LiteralPath $replacement) { Remove-Item -LiteralPath $replacement -Force }
    if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Recurse -Force }
  }
}

Write-Output "Sanitized $($archives.Count) Playwright trace archive(s)."
