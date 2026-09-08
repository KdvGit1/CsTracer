param([switch]$TestsOnly, [string]$Version = '')
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $root
$reportDir = Join-Path $root ('release\checks\' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
$steps = @()
$started = Get-Date
$failure = $null
$completed = $false
$lock = $null
function Run-Step([string]$Name, [string]$Executable, [string[]]$Arguments) {
  $log = Join-Path $reportDir ($Name + '.log')
  Write-Host (">>> " + $Name) -ForegroundColor Cyan
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $Executable @Arguments *> $log
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousPreference }
  $script:steps += [pscustomobject]@{ step = $Name; exitCode = $code; seconds = [Math]::Round($watch.Elapsed.TotalSeconds, 1); log = $log }
  if ($code -ne 0) { throw "$Name failed (exit $code). See $log" }
}
try {
  $lock = [IO.File]::Open((Join-Path $root 'release\checks.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
  $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $currentVersion = (Get-Content -LiteralPath (Join-Path $root 'version.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
  $targetVersion = $currentVersion
  if (-not $TestsOnly) {
    $validator = Join-Path $PSScriptRoot 'package-version.mjs'
    $suggested = & $node $validator suggest $currentVersion (Join-Path $root 'release')
    if ($LASTEXITCODE -ne 0) { throw 'Sürüm önerisi oluşturulamadı.' }
    do {
      $choice = if ($Version) { $Version } else { Read-Host "Mevcut sürüm: $currentVersion. Yeni paket sürümü [Enter: $suggested]" }
      if ([string]::IsNullOrWhiteSpace($choice)) { $choice = $suggested }
      $choice = $choice.Trim()
      $previousPreference = $ErrorActionPreference
      try { $ErrorActionPreference = 'Continue'; $validated = & $node $validator validate $currentVersion (Join-Path $root 'release') $choice 2>&1; $validExit = $LASTEXITCODE }
      finally { $ErrorActionPreference = $previousPreference }
      if ($validExit -ne 0) {
        if ($Version) { throw ($validated -join "`n") }
        Write-Host ($validated -join "`n") -ForegroundColor Yellow
      }
    } while ($validExit -ne 0)
    $targetVersion = $choice
    Run-Step 'version' $node @((Join-Path $PSScriptRoot 'sync-version-files.mjs'), (Join-Path $root 'version.json'), (Join-Path $root 'package.json'), (Join-Path $root 'package-lock.json'), $targetVersion, (Get-Date -Format 'yyyy-MM-dd'))
  }
  Run-Step 'typecheck' $npm @('run', 'typecheck')
  Run-Step 'lint' $npm @('run', 'lint')
  Run-Step 'build' $npm @('run', 'build')
  Run-Step 'tests' $npm @('test')
  if (-not $TestsOnly) {
    Run-Step 'package' 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'create-patch.ps1'), '-SkipBuild', '-CreateRar', '-ExpectedVersion', $targetVersion)
    Run-Step 'portable' 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'package-portable.ps1'), '-SkipBuild', '-CreateRar', '-ExpectedVersion', $targetVersion)
  }
  $completed = $true
} catch { $failure = $_.Exception.Message }
finally {
  if (-not $completed -and -not $failure) { $failure = 'The run was interrupted before all checks completed.' }
  if ($lock) { $lock.Dispose() }
  $result = [ordered]@{ success = ($null -eq $failure); version = $targetVersion; startedAt = $started.ToString('o'); finishedAt = (Get-Date).ToString('o'); testsOnly = [bool]$TestsOnly; error = $failure; steps = $steps }
  $json = $result | ConvertTo-Json -Depth 6
  $json | Set-Content -LiteralPath (Join-Path $reportDir 'summary.json') -Encoding UTF8
  $lines = @('# TRACER test / package report', '', ('Result: ' + $(if ($failure) { 'FAILED' } else { 'PASSED' })), ('Started: ' + $result.startedAt), '')
  foreach ($step in $steps) { $lines += ('- {0}: exit {1}, {2}s. Log: {3}' -f $step.step, $step.exitCode, $step.seconds, $step.log) }
  $lines += ('Version: ' + $targetVersion)
  if ($failure) {
    $lines += @('', $failure, '', 'Package was not approved. Fix the failed step and rerun.')
    if ($steps.Count -gt 0) { $lines += @('', 'Last output:', '```') + @(Get-Content -LiteralPath $steps[-1].log -Tail 25) + @('```') }
  }
  if (-not $failure -and -not $TestsOnly) {
    $artifacts = @(Get-ChildItem -LiteralPath (Join-Path $root 'release') -File | Where-Object { $_.Extension -in @('.zip', '.rar') -and $_.LastWriteTime -ge $started })
    foreach ($artifact in $artifacts) { $lines += ('Artifact: {0} ({1} bytes), SHA256 {2}' -f $artifact.FullName, $artifact.Length, (Get-FileHash -LiteralPath $artifact.FullName -Algorithm SHA256).Hash) }
  }
  $lines += @('', 'Package mode: patch ZIP/RAR and full portable folder/RAR including model and runtime. No publishing or Discord sending.', 'Includes current source in the production build; does not include player data or sessions.')
  $summary = Join-Path $reportDir 'summary.md'
  $lines | Set-Content -LiteralPath $summary -Encoding UTF8
  if ($lock) {
    $json | Set-Content -LiteralPath (Join-Path $root 'release\LAST-CHECK.json') -Encoding UTF8
    $lines | Set-Content -LiteralPath (Join-Path $root 'release\LAST-CHECK.md') -Encoding UTF8
  }
  Write-Host ("Report: " + $summary)
}
if ($failure) { Write-Host $failure -ForegroundColor Red; exit 1 }
Write-Host 'All checks passed.' -ForegroundColor Green
exit 0
