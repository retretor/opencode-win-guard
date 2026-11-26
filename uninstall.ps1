<#
.SYNOPSIS
  Removes opencode-win-guard: opens the closed files again, takes the Low labels off the folders, removes the plugins.

.DESCRIPTION
  By default the sandbox folder (launcher, Git copy, caches, secrets.txt) and win-guard.json are kept, so that a new
  install finds them; -RemoveData deletes them as well. Stop opencode before you run it.
#>
[CmdletBinding()]
param(
  [string]$ConfigDir = $(if ($env:XDG_CONFIG_HOME) { Join-Path $env:XDG_CONFIG_HOME "opencode" } else { Join-Path $HOME ".config\opencode" }),
  [string]$SandboxHome = $(if ($env:OPENCODE_SANDBOX_HOME) { $env:OPENCODE_SANDBOX_HOME } else { Join-Path $HOME ".local\share\opencode\sandbox" }),
  [switch]$RemoveData
)
$ErrorActionPreference = "Stop"

# 1. the secret files: labels off
$protect = Join-Path $SandboxHome "bin\protect.exe"
if (Test-Path $protect) {
  $out = & $protect --undo
  $bad = @($out | Where-Object { $_ -like "FAILED*" })
  Write-Host "secret files opened again: $(@($out).Count - $bad.Count), failed: $($bad.Count)"
  $bad | ForEach-Object { Write-Host "  $_" }
}

# 2. the folders that got a Low label (project folders, cache, "lowLabel" folders)
$labelled = Join-Path $SandboxHome "labelled.json"
if (Test-Path $labelled) {
  foreach ($dir in (Get-Content $labelled -Raw | ConvertFrom-Json)) {
    $d = $dir -replace "/", "\"
    if (Test-Path $d) {
      # files made by sandboxed programs carry a Low label of their own: /T resets them too
      & icacls.exe $d /setintegritylevel "(OI)(CI)medium" /T /C /Q | Out-Null
      Write-Host "label reset: $d"
    }
  }
}

# 3. plugins
foreach ($p in "win-guard-sandbox.js", "win-guard-killswitch.js") {
  $f = Join-Path $ConfigDir "plugins\$p"
  if (Test-Path $f) { Remove-Item $f; Write-Host "removed $f" }
}

if ($RemoveData) {
  if (Test-Path $SandboxHome) { Remove-Item $SandboxHome -Recurse -Force; Write-Host "removed $SandboxHome" }
  $settings = Join-Path $ConfigDir "win-guard.json"
  if (Test-Path $settings) { Remove-Item $settings; Write-Host "removed $settings" }
}
Write-Host "Done. Restart opencode."
