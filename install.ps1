<#
.SYNOPSIS
  Installs opencode-win-guard: the launcher, the two plugins, and the settings files if they do not exist yet.

.DESCRIPTION
  - builds the launcher with the C# compiler of the .NET Framework that comes with Windows (no SDK needed)
  - copies Git for Windows into the sandbox folder (Git Bash starts at Low integrity only from a copy of its own); skip with -NoGit
  - copies secrets.example.txt to secrets.txt and win-guard.example.json to win-guard.json if they are missing
  - copies the plugins into the plugin folder of opencode
  - closes the files of secrets.txt (protect.exe --apply)
  Nothing needs administrator rights. Run it again to update; your secrets.txt and win-guard.json are kept.
  Stop opencode (or at least every agent command) before you run it.

.EXAMPLE
  .\install.ps1 -Folder C:\Users\me\Projects\my-project
#>
[CmdletBinding()]
param(
  # Project folders the agents may write to. Only used when win-guard.json does not exist yet.
  [string[]]$Folder = @(),
  [string]$ConfigDir = $(if ($env:XDG_CONFIG_HOME) { Join-Path $env:XDG_CONFIG_HOME "opencode" } else { Join-Path $HOME ".config\opencode" }),
  [string]$SandboxHome = $(if ($env:OPENCODE_SANDBOX_HOME) { $env:OPENCODE_SANDBOX_HOME } else { Join-Path $HOME ".local\share\opencode\sandbox" }),
  # Do not copy Git: then the agents get PowerShell and cmd, but no bash.
  [switch]$NoGit,
  # Copy Git again even if a copy exists (after an update of Git).
  [switch]$UpdateGit
)
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
if ($env:OS -ne "Windows_NT") { throw "opencode-win-guard works only on Windows." }

Write-Host "sandbox folder: $SandboxHome"
Write-Host "opencode config: $ConfigDir"
New-Item -ItemType Directory -Force (Join-Path $SandboxHome "bin"), (Join-Path $SandboxHome "cache"), (Join-Path $ConfigDir "plugins") | Out-Null

# 1. launcher
& cmd.exe /c "`"$here\launcher\build.cmd`" `"$SandboxHome\bin`""
if ($LASTEXITCODE -ne 0) { throw "building the launcher failed" }
Copy-Item "$here\launcher\bashenv.sh" (Join-Path $SandboxHome "bashenv.sh") -Force

# 2. Git copy
$gitCopy = Join-Path $SandboxHome "git"
if (-not $NoGit) {
  if ((Test-Path (Join-Path $gitCopy "usr\bin\bash.exe")) -and -not $UpdateGit) {
    Write-Host "Git copy exists: $gitCopy (use -UpdateGit to copy again)"
  } else {
    $git = Get-Command git.exe -ErrorAction SilentlyContinue
    if (-not $git) { throw "git.exe was not found on PATH. Install Git for Windows, or run with -NoGit." }
    # git.exe may be ...\Git\cmd, ...\Git\bin or ...\Git\mingw64\bin: go up to the folder that holds usr\bin\bash.exe
    $root = Split-Path $git.Source
    for ($i = 0; $i -lt 3 -and $root -and -not (Test-Path (Join-Path $root "usr\bin\bash.exe")); $i++) { $root = Split-Path $root }
    if (-not $root -or -not (Test-Path (Join-Path $root "usr\bin\bash.exe"))) { throw "no usr\bin\bash.exe above $($git.Source): is this Git for Windows? Run with -NoGit to go without bash." }
    Write-Host "copying Git from $root (several hundred MB) ..."
    & robocopy.exe $root $gitCopy /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "copying Git failed (robocopy $LASTEXITCODE)" }
  }
}

# 3. settings
$secrets = Join-Path $SandboxHome "secrets.txt"
if (-not (Test-Path $secrets)) {
  Copy-Item "$here\secrets.example.txt" $secrets
  Write-Host "created $secrets from the example: check that it lists the files with keys and passwords on this computer"
}
$settings = Join-Path $ConfigDir "win-guard.json"
if (-not (Test-Path $settings)) {
  $conf = Get-Content "$here\win-guard.example.json" -Raw | ConvertFrom-Json
  $conf.folders = @($Folder | ForEach-Object { (Resolve-Path $_).Path })
  ($conf | ConvertTo-Json -Depth 5) | Out-File $settings -Encoding utf8
  if ($Folder.Count -eq 0) { Write-Host "created $settings with no folders: add the project folders the agents may write to" }
  else { Write-Host "created $settings for: $($conf.folders -join ', ')" }
}

# 4. plugins
Copy-Item "$here\plugins\win-guard-sandbox.js", "$here\plugins\win-guard-killswitch.js" (Join-Path $ConfigDir "plugins") -Force

# 5. close the secret files
$protect = Join-Path $SandboxHome "bin\protect.exe"
$out = & $protect --apply
$failed = @($out | Where-Object { $_ -like "FAILED*" })
$out | Where-Object { $_ -notlike "closed*" } | ForEach-Object { Write-Host "  $_" }
Write-Host "closed: $(@($out | Where-Object { $_ -like 'closed*' }).Count) files or folders, failed: $($failed.Count)"

Write-Host ""
Write-Host "Done. Restart opencode. The log is in ~\.local\share\opencode\log\win-guard.log; it says 'on for <folder>' when a session starts in a listed folder."
Write-Host "Check what is closed:  & `"$protect`" --list"
