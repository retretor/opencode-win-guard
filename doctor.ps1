<#
.SYNOPSIS
  Checks an installation of opencode-win-guard and tells why commands were refused.

.DESCRIPTION
  - the plugins, the launcher, the Git copy and the settings are in place
  - the project folder and its cache carry the Low label
  - a real command through the launcher runs at Low integrity, may write to the cache and may not write elsewhere
  - the files of secrets.txt are closed, and closed to that command too
  - whether the agents of the folder are stopped, and the last refusals and stops from the log
  - with -Why: what the plugins would say about one shell command, before an agent runs it (needs Node.js)
  It changes nothing, apart from one test file in the cache folder that it deletes again. No network access.
  Exit code 1 when something is broken.

.EXAMPLE
  & "$HOME\.local\share\opencode\sandbox\doctor.ps1"
  & "$HOME\.local\share\opencode\sandbox\doctor.ps1" -Folder C:\Users\me\Projects\my-project -Why "npm test"
#>
[CmdletBinding()]
param(
  # The project folder to check. Default: the current folder if it is in win-guard.json, otherwise every folder there.
  [string]$Folder,
  # A shell command to check, as an agent would send it.
  [string]$Why,
  # How many lines of the log to show.
  [int]$Last = 15,
  [string]$ConfigDir = $(if ($env:XDG_CONFIG_HOME) { Join-Path $env:XDG_CONFIG_HOME "opencode" } else { Join-Path $HOME ".config\opencode" }),
  [string]$SandboxHome = $(if ($env:OPENCODE_SANDBOX_HOME) { $env:OPENCODE_SANDBOX_HOME } else { Join-Path $HOME ".local\share\opencode\sandbox" })
)
# Not "Stop": PowerShell 5.1 would turn any line a program writes to stderr into an error.
$ErrorActionPreference = "Continue"
$script:bad = 0
$script:warn = 0
function Ok($t) { Write-Host "  ok    $t" }
function Warn($t) { $script:warn++; Write-Host "  WARN  $t" -ForegroundColor Yellow }
function Bad($t) { $script:bad++; Write-Host "  FAIL  $t" -ForegroundColor Red }
function Head($t) { Write-Host ""; Write-Host $t }

$settingsFile = if ($env:OPENCODE_WIN_GUARD_CONFIG) { $env:OPENCODE_WIN_GUARD_CONFIG } else { Join-Path $ConfigDir "win-guard.json" }
$data = if ($env:XDG_DATA_HOME) { $env:XDG_DATA_HOME } else { Join-Path $HOME ".local\share" }
$logFile = Join-Path $data "opencode\log\win-guard.log"
$bin = Join-Path $SandboxHome "bin"
$systemPs = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"

# The same names as the plugins use: lower case, forward slashes, no trailing slash.
function Norm($p) { ([IO.Path]::GetFullPath($p) -replace '\\', '/').TrimEnd('/').ToLowerInvariant() }
function Inside($p, $dir) { $p -eq $dir -or $p.StartsWith("$dir/") }
# The plugins name the cache and the stop of a folder "<name>-<hash>"; the hash does not depend on the case of the path.
function Hash($root) {
  $sha = New-Object Security.Cryptography.SHA1Managed
  (-join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes((Norm $root))) | ForEach-Object { $_.ToString("x2") })).Substring(0, 8)
}
function Named($dir, $hash, $ext) { Get-ChildItem $dir -Filter "*-$hash$ext" -ErrorAction SilentlyContinue | Select-Object -First 1 }
# The integrity label of a folder, read the same way as the launcher does (icacls prints it in the language of Windows).
Add-Type -Namespace WinGuard -Name Label -MemberDefinition @'
[DllImport("advapi32.dll", CharSet = CharSet.Unicode)] static extern uint GetNamedSecurityInfoW(string name, int type, uint info, IntPtr owner, IntPtr group, IntPtr dacl, out IntPtr sacl, out IntPtr sd);
[DllImport("advapi32.dll", CharSet = CharSet.Unicode)] static extern bool ConvertSecurityDescriptorToStringSecurityDescriptorW(IntPtr sd, uint rev, uint info, out IntPtr text, IntPtr len);
[DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);
public static string Of(string path) {
  IntPtr sacl, sd, text; string s = null;
  if (GetNamedSecurityInfoW(path, 1, 0x10, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, out sacl, out sd) != 0) return null;
  if (ConvertSecurityDescriptorToStringSecurityDescriptorW(sd, 1, 0x10, out text, IntPtr.Zero)) { s = Marshal.PtrToStringUni(text); LocalFree(text); }
  LocalFree(sd); return s;
}
'@
# Runs one launcher with the environment the sandbox plugin would give it; output and errors are kept apart.
function Launch($name, $arguments, $vars) {
  $saved = @{}
  foreach ($k in $vars.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, $vars[$k]) }
  $o = [IO.Path]::GetTempFileName(); $e = [IO.Path]::GetTempFileName()
  try {
    $p = Start-Process -FilePath (Join-Path $bin $name) -ArgumentList $arguments -NoNewWindow -Wait -PassThru -RedirectStandardOutput $o -RedirectStandardError $e
    @{ Code = $p.ExitCode; Out = "$(Get-Content $o -Raw)"; Err = "$(Get-Content $e -Raw)".Trim() }
  } finally {
    foreach ($k in $vars.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
    Remove-Item $o, $e -Force -ErrorAction SilentlyContinue
  }
}
function IsLow($dir) { [string]([WinGuard.Label]::Of($dir)) -match ';;;LW\)' }

Write-Host "opencode-win-guard doctor"
Write-Host "  settings: $settingsFile"
Write-Host "  sandbox:  $SandboxHome"
Write-Host "  log:      $logFile"

# ---- files
Head "Files"
foreach ($p in "win-guard-sandbox.js", "win-guard-killswitch.js") {
  $f = Join-Path $ConfigDir "plugins\$p"
  if (Test-Path $f) { Ok "plugin $p" } else { Bad "plugin $p is missing in $(Split-Path $f): run install.ps1" }
}
foreach ($p in "bash.exe", "powershell.exe", "pwsh.exe", "cmd.exe", "protect.exe") {
  if (-not (Test-Path (Join-Path $bin $p))) { Bad "launcher $p is missing in ${bin}: run install.ps1" }
}
if (Test-Path (Join-Path $bin "protect.exe")) { Ok "launcher in $bin" }
if (-not (Test-Path (Join-Path $SandboxHome "bashenv.sh"))) { Bad "bashenv.sh is missing in ${SandboxHome}: run install.ps1" }
$gitBash = Join-Path $SandboxHome "git\usr\bin\bash.exe"
$hasBash = Test-Path $gitBash
if ($hasBash) { Ok "Git copy: bash is available" } else { Warn "no Git copy: the agents get PowerShell and cmd, bash is refused (install.ps1 without -NoGit copies Git)" }

# ---- settings
Head "Settings"
$conf = $null
if (-not (Test-Path $settingsFile)) { Bad "$settingsFile does not exist: run install.ps1 -Folder <project>" }
else {
  try { $conf = (Get-Content $settingsFile -Raw -Encoding UTF8) | ConvertFrom-Json -ErrorAction Stop } catch { Bad "win-guard.json is not valid JSON: $($_.Exception.Message). The shell is refused until it is fixed." }
}
$folders = @()
if ($conf) {
  $folders = @($conf.folders | Where-Object { $_ })
  if (-not $folders.Count) { Bad "no folders in win-guard.json: nothing is guarded" }
  foreach ($f in $folders) {
    if (-not [IO.Path]::IsPathRooted($f)) { Bad "folder $f is not an absolute path" }
    elseif (-not (Test-Path $f -PathType Container)) { Warn "folder $f does not exist" }
  }
  if ($conf.killswitch -eq "watch") { Warn 'killswitch: "watch": nothing is refused or stopped, the log only says what would have been. The sandbox works as usual.' }
  else { Ok "killswitch: on" }
  $limits = @{ ramFreeGB = 4; diskFreeGB = 15; folderGB = 15 }
  foreach ($k in @($limits.Keys)) { if ($conf.limits -and $null -ne $conf.limits.$k) { $limits[$k] = [double]$conf.limits.$k } }
  Ok ("limits: {0} GB of memory and {1} GB of disk stay free, folder with cache up to {2} GB" -f $limits.ramFreeGB, $limits.diskFreeGB, $limits.folderGB)
  if ($conf.agents -and $conf.agents -ne "*") { Ok "guarded agents: $(@($conf.agents) -join ', ')" } else { Ok "guarded agents: all" }
}

$targets = @()
if ($Folder) { $targets = @([IO.Path]::GetFullPath($Folder)) }
else {
  $cwd = Norm (Get-Location).Path
  $mine = @($folders | Where-Object { Inside $cwd (Norm $_) })
  $targets = if ($mine.Count) { $mine } else { @($folders | Where-Object { Test-Path $_ -PathType Container }) }
}

# ---- secret files
Head "Secret files"
$secretsFile = Join-Path $SandboxHome "secrets.txt"
$closedFile = $null
if (-not (Test-Path $secretsFile)) { Bad "secrets.txt is missing in ${SandboxHome}: the shell is refused" }
elseif (Test-Path (Join-Path $bin "protect.exe")) {
  $list = @(& (Join-Path $bin "protect.exe") --list)
  $closed = @($list | Where-Object { $_ -like "closed  *" })
  $open = @($list | Where-Object { $_ -like "OPEN  *" })
  Ok "$($closed.Count) files or folders of secrets.txt are closed"
  foreach ($o in $open) { Bad "open to the sandbox: $($o.Substring(6)) (the next command closes it; if it stays open, check its rights)" }
  $closedFile = $closed | ForEach-Object { $_.Substring(8) } | Where-Object { Test-Path $_ -PathType Leaf } | Select-Object -First 1
  Write-Host "        Only existing files are listed. Add the files with keys and passwords of this computer to $secretsFile"
}

# ---- each folder
foreach ($root in $targets) {
  Head "Folder $root"
  $hash = Hash $root
  $c = Named (Join-Path $SandboxHome "cache") $hash ""
  $cache = if ($c) { $c.FullName } else { Join-Path $SandboxHome "cache\<name>-$hash" }
  if (IsLow $root) { Ok "the folder carries the Low label" } else { Warn "the folder has no Low label yet: it gets it when a session starts there" }
  if (Test-Path $cache) { if (IsLow $cache) { Ok "cache $cache carries the Low label" } else { Bad "cache $cache has no Low label" } }
  else { Warn "no cache folder yet ($cache): it is made when a session starts there" }

  $stopFile = Named (Join-Path $SandboxHome "stopped") $hash ".json"
  if ($stopFile) {
    $s = Get-Content $stopFile.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    Bad "the agents are STOPPED since $($s.time): $($s.reason) (by $($s.by)). Write a message in a session of this folder to go on."
  } else { Ok "the agents are not stopped" }
  if (Test-Path (Join-Path $root "STOP")) { Warn "a file STOP is in the folder: the agents stop at once. Delete it to go on." }

  # A real command through the launcher, as an agent's shell would run it.
  if ($conf -and (Test-Path (Join-Path $bin "powershell.exe")) -and (Test-Path $cache)) {
    $probe = Join-Path $SandboxHome "doctor-probe-$PID.txt"
    $inCache = Join-Path $cache "doctor-probe-$PID.txt"
    $whoami = Join-Path $env:SystemRoot "System32\whoami.exe"
    $lines = @(
      "try { `$g = & '$whoami' /groups /fo csv | Select-String 'S-1-16-\d+'; 'level: ' + `$g.Matches[0].Value } catch { 'level: unknown' }",
      "try { [IO.File]::WriteAllText('$inCache', 'x'); Remove-Item '$inCache'; 'cache: wrote' } catch { 'cache: denied' }",
      "try { [IO.File]::WriteAllText('$probe', 'x'); 'outside: WROTE' } catch { 'outside: denied' }"
    )
    if ($closedFile) { $lines += "try { [IO.File]::OpenRead('$closedFile').Dispose(); 'secret: READ' } catch { 'secret: denied' }" }
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($lines -join "`n"))
    $env1 = @{
      OPENCODE_SANDBOX_SHELL = $systemPs; OPENCODE_SANDBOX_FOLDERS = "$root|$cache"
      OPENCODE_SANDBOX_RAM_FREE_MB = [string][math]::Round($limits.ramFreeGB * 1024); OPENCODE_SANDBOX_DISK_FREE_MB = [string][math]::Round($limits.diskFreeGB * 1024)
      OPENCODE_SANDBOX_FOLDERS_MAX_MB = [string][math]::Round($limits.folderGB * 1024)
    }
    $r = Launch "powershell.exe" "-NoProfile -NonInteractive -EncodedCommand $encoded" $env1
    if (Test-Path $probe) { Remove-Item $probe -Force }
    if ($r.Code -eq 125 -or $r.Code -eq 126) { Bad "the launcher did not run the command (exit code $($r.Code)): $($r.Err)" }
    else {
      if ($r.Out -match 'level: S-1-16-4096\b') { Ok "commands run at Low integrity" } else { Bad "the command did not run at Low integrity: $($r.Out) $($r.Err)" }
      if ($r.Out -match 'cache: wrote') { Ok "the command may write to the cache" } else { Bad "the command may not write to its cache: builds will fail" }
      if ($r.Out -match 'outside: denied') { Ok "Windows refuses its writes outside the folder" } else { Bad "the command could write outside the folder" }
      if ($closedFile) { if ($r.Out -match 'secret: denied') { Ok "it cannot read a closed file ($closedFile)" } else { Bad "it could read $closedFile" } }
    }
    if ($hasBash) {
      $env2 = $env1.Clone()
      $env2.OPENCODE_SANDBOX_SHELL = $gitBash
      $env2.PATH = "$SandboxHome\git\mingw64\bin;$SandboxHome\git\usr\bin;$env:PATH"
      $env2.BASH_ENV = (Join-Path $SandboxHome "bashenv.sh") -replace '\\', '/'
      $r = Launch "bash.exe" '-c "echo bash-ok"' $env2
      if ($r.Out -match 'bash-ok') { Ok "Git Bash starts in the sandbox" } else { Bad "Git Bash does not start in the sandbox (exit code $($r.Code)): $($r.Err) Try install.ps1 -UpdateGit" }
    }
  }
}

# ---- the log
Head "Log"
if (-not (Test-Path $logFile)) { Warn "no log yet: no session has started in a guarded folder since the install" }
else {
  $all = @(Get-Content $logFile -Tail 5000 -Encoding UTF8)
  $starts = @($all | Where-Object { $_ -match '\] (on|watching|BROKEN|still stopped)' })
  if ($starts.Count) { Write-Host "  last start: $($starts[-1])" }
  $broken = @($all | Where-Object { $_ -match '\] BROKEN' })
  if ($broken.Count -and $starts.Count -and $starts[-1] -match 'BROKEN') { Bad "the last start was broken, see the line above" }
  $events = @($all | Where-Object { $_ -match '\] (stop|refuse|STOP|WATCH would|denied edit|no shell|released)' })
  if (-not $events.Count) { Ok "no refusals or stops in the log" }
  else {
    Write-Host "  last refusals and stops (newest last):"
    $events | Select-Object -Last $Last | ForEach-Object { Write-Host "    $_" }
  }
  $watch = @($all | Where-Object { $_ -match 'WATCH would (stop|refuse) \S+ \S+ (.+?) "' } | ForEach-Object { $null = $_ -match 'WATCH would (stop|refuse) \S+ \S+ (.+?) "'; "$($Matches[1]): $($Matches[2])" })
  if ($watch.Count) {
    Write-Host "  in watch mode these would have been refused or stopped:"
    $watch | Group-Object | Sort-Object Count -Descending | ForEach-Object { Write-Host ("    {0,4} x  {1}" -f $_.Count, $_.Name) }
  }
}

# ---- one command
if ($Why) {
  Head "Command: $Why"
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) { Warn "-Why needs Node.js to run the checks of the plugins" }
  else {
    $dir = if ($targets.Count) { $targets[0] } else { (Get-Location).Path }
    $js = @'
import path from "node:path"
import { pathToFileURL } from "node:url"
const plugins = process.env.WG_PLUGINS, dir = process.env.WG_DIR, command = process.env.WG_WHY
const sb = (await import(pathToFileURL(path.join(plugins, "win-guard-sandbox.js")))).default._test
const ks = (await import(pathToFileURL(path.join(plugins, "win-guard-killswitch.js")))).default._test
let list = []
try { list = ks.secrets() } catch (e) { console.log("  (secrets.txt could not be read: " + e.message + ")") }
const a = sb.shellVerdict(command)
if (a) console.log("  refused by the sandbox: " + a)
const v = ks.check(command, dir, dir, list)
if (v) console.log((v.act === "stop" ? "  STOP of all agents: " : "  refused by the killswitch: ") + v.why)
if (!a && !v) console.log("  allowed. Windows still refuses its writes outside the folder and reads of closed files.")
'@
    $tmp = Join-Path ([IO.Path]::GetTempPath()) "win-guard-why-$PID.mjs"
    [IO.File]::WriteAllText($tmp, $js)
    $env:WG_PLUGINS = Join-Path $ConfigDir "plugins"; $env:WG_DIR = $dir; $env:WG_WHY = $Why; $oldHome = $env:OPENCODE_SANDBOX_HOME; $env:OPENCODE_SANDBOX_HOME = $SandboxHome
    try { & $node.Source $tmp } finally { Remove-Item $tmp -Force; Remove-Item Env:WG_PLUGINS, Env:WG_DIR, Env:WG_WHY; $env:OPENCODE_SANDBOX_HOME = $oldHome }
  }
}

Write-Host ""
if ($script:bad) { Write-Host "$($script:bad) problem(s), $($script:warn) warning(s)." -ForegroundColor Red; exit 1 }
Write-Host "No problems, $($script:warn) warning(s)."
exit 0
