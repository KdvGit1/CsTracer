param([string]$Release = '2000899')
$ErrorActionPreference = 'Stop'
if ($Release -notmatch '^\d+$') { throw 'Invalid geometry release' }
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$target = Join-Path $root 'companion\geometry'
$tempDir = Join-Path $root ('work\geometry-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $target,$tempDir -Force | Out-Null
$base = "https://github.com/pnxenopoulos/awpy-data/releases/download/$Release"
$manifest = Invoke-RestMethod -Uri "$base/manifest.json"
$zipPath = Join-Path $tempDir 'geometry.zip'
Invoke-WebRequest -UseBasicParsing -Uri "$base/geometry.zip" -OutFile $zipPath
if ((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLower() -ne $manifest.artifacts.'geometry.zip'.sha256) { throw 'Geometry checksum mismatch' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
$files = @{}
try {
  foreach ($entry in $archive.Entries) {
    if ($entry.FullName -notmatch '^(?:geometry/)?((?:de|cs|ar)_[a-z0-9_]+)\.mesh$') { continue }
    $name = $Matches[1]
    $out = Join-Path $target ($name + '.mesh.gz')
    $inputStream = $entry.Open()
    $outputStream = [IO.File]::Create($out)
    $gzip = New-Object IO.Compression.GZipStream($outputStream, [IO.Compression.CompressionLevel]::Optimal)
    try { $inputStream.CopyTo($gzip) } finally { $gzip.Dispose(); $outputStream.Dispose(); $inputStream.Dispose() }
    $files[$name] = @{ file = "$name.mesh.gz"; sha256 = (Get-FileHash -LiteralPath $out -Algorithm SHA256).Hash.ToLower() }
  }
} finally { $archive.Dispose() }
if (-not $files.ContainsKey('de_cache') -or -not $files.ContainsKey('de_inferno')) { throw 'Incomplete map geometry' }
@{ source = $base; release = $Release; clientVersion = $manifest.client_version; sourceRevision = $manifest.source_revision; generatedAt = $manifest.generated_at; maps = $files } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $target 'manifest.json') -Encoding UTF8
"Collision geometry: $($files.Count) maps, release $Release" | Write-Output
# Only the unique staging directory created above is removed.
if (-not [IO.Path]::GetFullPath($tempDir).StartsWith((Join-Path $root 'work\geometry-'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe staging path' }
Remove-Item -LiteralPath $tempDir -Recurse -Force
