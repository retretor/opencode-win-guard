// opencode-win-guard, part 1 of 2: a write sandbox for opencode agents on Windows.
//
// In the folders listed in <config>/opencode/win-guard.json the agents may read everything but write only inside the folder:
//
//   { "folders": ["C:\\Users\\me\\Projects\\my-project"], "limits": { "ramFreeGB": 4, "diskFreeGB": 15, "folderGB": 15 } }
//
//  - Tools (edit, write): the real path, with links resolved, must be inside the folder (or one of "alsoWritable").
//  - Shell: runs through a launcher that lowers the process to Low integrity. Windows then refuses every write,
//    delete and rights change outside folders labelled Low, whatever program does it. The folder and one cache
//    folder carry that label. Git Bash needs a copy of Git of its own for this, kept beside the launcher (install.ps1).
//  - Files with passwords (secrets.txt) are closed to these programs. The launcher also keeps `ramFreeGB` of memory and
//    `diskFreeGB` of the drive free, and the folder with its cache under `folderGB`.
//  - Drives without Windows rights (FAT) and AppData\LocalLow are open to Low processes, so commands that name them are refused.
//  - If any part is missing or fails, the shell is refused for these agents: it never falls back to full rights.
//
//  - Tools that are not known to write nothing are refused (a new plugin or MCP server would run with full rights);
//    "extraTools" adds names.
//
// It protects against mistakes. It is not a wall against a program written to break out. No network access.
// See README.md and SECURITY.md.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"
import { execFile, execFileSync } from "node:child_process"

const DATA = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
const CONFIG = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "opencode")
const HOME = process.env.OPENCODE_SANDBOX_HOME || path.join(os.homedir(), ".local", "share", "opencode", "sandbox")
const LIST = process.env.OPENCODE_WIN_GUARD_CONFIG || path.join(CONFIG, "win-guard.json")
const SHELLS = ["bash.exe", "powershell.exe", "pwsh.exe", "cmd.exe"] // OpenCode picks the arguments by the program name, so there is one launcher per name
const launcher = (name) => path.join(HOME, "bin", name)
const GIT = path.join(HOME, "git")
const BASH = path.join(GIT, "usr", "bin", "bash.exe")
const BASHENV = path.join(HOME, "bashenv.sh")
const LABELLED = path.join(HOME, "labelled.json")
const LOG = path.join(DATA, "opencode", "log", "win-guard.log")
// Tools that write nothing, or whose writes are checked below. Anything else (a new plugin, an MCP server) would run with full rights.
const TOOLS = ["read", "glob", "grep", "list", "skill", "subagent", "todowrite", "todoread", "webfetch", "websearch", "question", "edit", "write", "shell"]
const SYSTEM32 = path.join(process.env.SystemRoot || "C:\\Windows", "System32")
// Caches and settings folders of common tools, moved into a cache folder of the project that the sandbox may write.
// Without this a build fails, because it cannot write its usual folder in your profile. Values are folder names in that cache.
const CACHES = {
  TEMP: "tmp",
  TMP: "tmp",
  TMPDIR: "tmp",
  APPDATA: "appdata", // many programs fail, or crash, when they cannot write their settings
  LOCALAPPDATA: "localappdata",
  npm_config_cache: "npm",
  YARN_CACHE_FOLDER: "yarn",
  npm_config_store_dir: "pnpm-store",
  BUN_INSTALL_CACHE_DIR: "bun",
  PIP_CACHE_DIR: "pip",
  UV_CACHE_DIR: "uv",
  POETRY_CACHE_DIR: "poetry",
  GOCACHE: "go-build",
  GOMODCACHE: "go-mod",
  GRADLE_USER_HOME: "gradle",
  NUGET_PACKAGES: "nuget",
  NUGET_HTTP_CACHE_PATH: "nuget-http",
  NUGET_PLUGINS_CACHE_PATH: "nuget-plugins",
  DOTNET_CLI_HOME: "dotnet",
}
// No telemetry, and no build servers: one started outside the sandbox would do the sandbox's work with full rights.
const QUIET = {
  DOTNET_CLI_TELEMETRY_OPTOUT: "1",
  DOTNET_NOLOGO: "1",
  DOTNET_CLI_USE_MSBUILD_SERVER: "0",
  MSBUILDDISABLENODEREUSE: "1",
  UseSharedCompilation: "false",
  GRADLE_OPTS: "-Dorg.gradle.daemon=false",
}

const log = (...parts) => {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true })
    fs.appendFileSync(LOG, `${new Date().toISOString()} [sandbox] ${parts.join(" ")}\n`)
  } catch {}
}
const norm = (p) => path.resolve(p).replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()
const inside = (p, dir) => p === dir || p.startsWith(dir + "/")

// Links in the path are resolved, so a link inside the folder cannot lead a write out of it.
function real(p) {
  let cur = path.resolve(p)
  const rest = []
  for (;;) {
    try {
      fs.lstatSync(cur)
      break
    } catch (e) {
      if (e.code !== "ENOENT" && e.code !== "ENOTDIR") throw e
      const up = path.dirname(cur)
      if (up === cur) break
      rest.unshift(path.basename(cur))
      cur = up
    }
  }
  return path.join(fs.realpathSync.native(cur), ...rest)
}

// A folder that holds the user's whole profile, a drive or the system must never be opened.
function unsafe(root) {
  const r = norm(root)
  if (/^[a-z]:$/.test(r) || /^[a-z]:\/$/.test(r)) return "it is a whole drive"
  const keep = [os.homedir(), CONFIG, DATA, HOME, SYSTEM32, process.env.APPDATA, process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env.ProgramData]
  for (const k of keep) if (k && inside(norm(k), r)) return `it contains ${k}`
  for (const k of [CONFIG, HOME, process.env.SystemRoot, process.env.ProgramFiles]) if (k && inside(r, norm(k))) return `it is inside ${k}`
}

// Settings, also read by the killswitch. A broken file switches the agents off rather than on.
const settings = { folders: [], limits: { ramFreeGB: 4, diskFreeGB: 15, folderGB: 15 }, agents: "*", extraTools: [], alsoWritable: [], lowLabel: [], env: {} }
// %NAME% at the start of a path is taken from the environment of OpenCode (the real one, not the sandbox's).
const expand = (p) => String(p).replace(/^%([A-Za-z_]\w*)%/, (m, k) => process.env[k] ?? m)
function listed(here, file = LIST) {
  let conf
  try {
    conf = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""))
  } catch (e) {
    if (e.code === "ENOENT") return
    throw e
  }
  if (!Array.isArray(conf.folders) || !conf.folders.every((f) => typeof f === "string" && path.isAbsolute(f))) throw new Error('"folders" must be a list of absolute paths')
  settings.folders = conf.folders
  for (const k of Object.keys(settings.limits)) if (Number.isFinite(conf.limits?.[k]) && conf.limits[k] >= 0) settings.limits[k] = conf.limits[k]
  if (conf.agents !== undefined) settings.agents = conf.agents === "*" ? "*" : [].concat(conf.agents).map(String)
  if (conf.extraTools !== undefined) settings.extraTools = [].concat(conf.extraTools).map(String)
  if (conf.alsoWritable !== undefined) settings.alsoWritable = [].concat(conf.alsoWritable).map(String).filter((f) => path.isAbsolute(f))
  if (conf.lowLabel !== undefined) settings.lowLabel = [].concat(conf.lowLabel).map(expand)
  if (!settings.lowLabel.every((f) => path.isAbsolute(f))) throw new Error('"lowLabel" must be a list of absolute paths (%APPDATA% and the like are allowed at the start)')
  if (conf.env !== undefined) {
    if (!conf.env || typeof conf.env !== "object" || Array.isArray(conf.env) || !Object.values(conf.env).every((v) => typeof v === "string")) throw new Error('"env" must be an object of strings')
    const own = Object.keys(conf.env).find((k) => /^(?:OPENCODE_SANDBOX_\w*|BASH_ENV|PATH)$/i.test(k))
    if (own) throw new Error(`"env" may not set ${own}: the sandbox sets it itself`)
    settings.env = conf.env
  }
  const h = norm(here)
  return settings.folders.find((f) => inside(h, norm(f)))
}
const covered = (agent) => settings.agents === "*" || settings.agents.includes(agent)
const limits = settings.limits

// The first time it waits; later loads repeat it in the background, so files moved in from elsewhere get the label too.
function label(dir) {
  const call = [path.join(SYSTEM32, "icacls.exe"), [dir, "/setintegritylevel", "(OI)(CI)low"], { windowsHide: true }]
  let done = []
  try {
    done = JSON.parse(fs.readFileSync(LABELLED, "utf8"))
  } catch {}
  if (done.includes(norm(dir))) return void execFile(...call, (e) => e && log("label", dir, e.message))
  execFileSync(...call)
  fs.writeFileSync(LABELLED, JSON.stringify([...done, norm(dir)], null, 1))
  log("labelled", dir)
}

// Settings in the project from which OpenCode, git, other coding agents or editors would run programs with full rights.
const PROTECTED = /(?:^|\/)(?:\.opencode|\.git|\.claude|\.codex|\.gemini|\.cursor|\.windsurf|\.husky)(?:\/|$)|(?:^|\/)(?:opencode\.jsonc?|\.vscode\/(?:tasks|settings|launch)\.json|\.envrc)$/i
const SHELL_DENY = [
  [/\.opencode\b|\bopencode\.jsonc?\b/i, "OpenCode's own settings in the project are off limits"],
  [/\.git[\\/]+(?:hooks|config)\b|\bcore\.(?:fsmonitor|hookspath|sshcommand|pager|editor)\b/i, "git hooks and git settings that run programs are off limits"],
  [/\blocallow\b/i, "AppData\\LocalLow cannot be protected from the shell"],
]

const SYS = (process.env.SystemDrive || "C:")[0].toLowerCase()
const LETTERS = [..."abcdefghijklmnopqrstuvwxyz"].filter((l) => l !== SYS)

function shellVerdict(command, drives = LETTERS.filter((l) => fs.existsSync(`${l}:\\`))) {
  for (const [re, why] of SHELL_DENY) if (re.test(command)) return why
  const d = drives.find((l) =>
    new RegExp(`(?:^|[\\s"'=(;&|>])${l}:(?=[\\\\/]|$|["';&|)]|[A-Za-z0-9_.])|\\b(?:cd|sl|pushd|chdir|set-location|push-location)\\s+(?:/d\\s+)?["\']?${l}:|(?:^|[\\s"'=:(;&|>])/(?:cygdrive/|mnt/)?${l}(?:/|[\\s"';&|)]|$)`, "i").test(command),
  )
  if (d) return `drive ${d.toUpperCase()}: cannot be protected from the shell (reading it with \`read\`, \`glob\` and \`grep\` is fine)`
}

function find(name, dirs) {
  for (const d of dirs) if (path.isAbsolute(d) && fs.existsSync(path.join(d, name))) return path.join(d, name)
}

export default {
  id: "win-guard-sandbox",
  _test: { real, unsafe, shellVerdict, PROTECTED, inside, norm, listed, settings, expand, CACHES },
  async setup(ctx) {
    const here = ctx.location?.directory
    if (!here) return
    let root, broken
    try {
      root = listed(here)
      if (!root) return
      if (process.platform !== "win32") throw new Error("only for Windows")
      const why = unsafe(root)
      if (why) throw new Error(`the folder is not allowed: ${why}`)
      root = fs.realpathSync.native(root)
      for (const f of [...SHELLS.map(launcher), BASHENV, path.join(HOME, "secrets.txt")]) if (!fs.existsSync(f)) throw new Error(`missing ${f} (run install.ps1)`)
      for (const w of settings.alsoWritable) if (unsafe(w)) throw new Error(`"alsoWritable" ${w} is not allowed: ${unsafe(w)}`)
    } catch (e) {
      broken = e?.message || String(e)
      if (root === undefined) root = here
    }
    const rootN = norm(root)
    const allowed = [rootN, ...settings.alsoWritable.map(norm)]
    const tools = new Set([...TOOLS, ...settings.extraTools])
    const noBash = !fs.existsSync(BASH) // without the copy of Git only PowerShell and cmd work
    const slug = `${path.basename(root).replace(/[^\p{L}\p{N}_-]+/gu, "-")}-${crypto.createHash("sha1").update(rootN).digest("hex").slice(0, 8)}`
    const cache = path.join(HOME, "cache", slug)
    const at = (n) => path.join(cache, n)
    if (!broken)
      try {
        for (const n of new Set(Object.values(CACHES))) fs.mkdirSync(at(n), { recursive: true })
        label(cache)
        label(root)
        for (const dir of settings.lowLabel) {
          const why = unsafe(dir)
          if (why) throw new Error(`"lowLabel" ${dir} is not allowed: ${why}`)
          fs.mkdirSync(dir, { recursive: true })
          label(dir)
        }
      } catch (e) {
        broken = e?.message || String(e)
      }
    log(broken ? `BROKEN (${broken}): shell refused` : `on${noBash ? " (no Git copy: bash refused)" : ""}`, "for", root)

    const mb = (gb) => String(Math.round(gb * 1024))
    const env = {
      OPENCODE_SANDBOX_RAM_FREE_MB: mb(limits.ramFreeGB),
      OPENCODE_SANDBOX_DISK_FREE_MB: mb(limits.diskFreeGB),
      OPENCODE_SANDBOX_FOLDERS_MAX_MB: mb(limits.folderGB),
      OPENCODE_SANDBOX_FOLDERS: `${root}|${cache}`,
      BASH_ENV: BASHENV.replaceAll("\\", "/"),
      ...Object.fromEntries(Object.entries(CACHES).map(([k, n]) => [k, at(n)])),
      ...QUIET,
      // Read-only fallback: packages you have already downloaded are found without downloading them again.
      NUGET_FALLBACK_PACKAGES: path.join(os.homedir(), ".nuget", "packages"),
      PYTHONUSERBASE: process.env.PYTHONUSERBASE || path.join(process.env.APPDATA || "", "Python"),
      ...Object.fromEntries(Object.entries(settings.env).map(([k, v]) => [k, v.replaceAll("${cache}", cache).replaceAll("${folder}", root)])),
    }

    const pending = [] // shell calls of the crew that are starting or running: { id, command, started }
    const mine = (event) => {
      const own = pending.find((p) => !p.started && p.command === event.command)
      if (own) return (own.started = true)
      // Not recognised while one of ours is still to start, or the same text as one of ours: lower the rights to be safe.
      return pending.some((p) => !p.started || p.command === event.command)
    }
    const drop = (event) => {
      const i = pending.findIndex((p) => p.id === event.sessionID + event.id)
      if (i >= 0) pending.splice(i, 1)
    }
    const sandbox = (event) => {
      const keys = Object.keys(event.env)
      const pathKey = keys.find((k) => k.toLowerCase() === "path") || "PATH"
      for (const k of Object.keys(env)) for (const o of keys) if (o !== k && o.toLowerCase() === k.toLowerCase()) delete event.env[o]
      const name = path.basename(event.shell).toLowerCase().replace(/(?:\.exe)?$/, ".exe")
      // Git programs must come from the copy: those of the installed Git do not start at Low integrity.
      const dirs = String(event.env[pathKey] || "").split(";").filter(Boolean).map((d) => d.replace(/^.*[\\/]Git(?=[\\/](?:usr|mingw64|cmd|bin)(?:[\\/]|$))/i, () => GIT))
      const shell = name === "bash.exe" ? BASH : path.isAbsolute(event.shell) ? event.shell : find(name, dirs)
      const ok = !broken && SHELLS.includes(name) && shell && !(name === "bash.exe" && noBash)
      Object.assign(event.env, env, { OPENCODE_SANDBOX_SHELL: ok ? shell : "" }) // empty: the launcher refuses
      const first = name === "bash.exe" ? [path.join(GIT, "mingw64", "bin"), path.join(GIT, "usr", "bin")] : []
      event.env[pathKey] = [...new Set([...first, ...dirs])].join(";")
      event.shell = launcher(SHELLS.includes(name) ? name : "bash.exe")
      if (!event.env.OPENCODE_SANDBOX_SHELL) log("no shell for", name)
    }
    let hooked = false
    try {
      await ctx.shell.hook("create.before", (event) => {
        if (!mine(event)) return // a command of the user or of another agent
        try {
          sandbox(event)
        } catch (e) {
          log("error", e?.stack || String(e))
          event.shell = launcher("bash.exe")
          if (event.env) event.env.OPENCODE_SANDBOX_SHELL = ""
        }
      })
      hooked = true
    } catch (e) {
      broken = `no shell hook: ${e?.message || e}`
      log("BROKEN", broken)
    }

    await ctx.tool.hook("execute.before", (event) => {
      if (!covered(event.agent)) return
      if (!tools.has(event.tool)) throw new Error(`Blocked: the tool ${event.tool} is not covered by the write sandbox of this folder.`)
      if (event.tool === "subagent" && !covered(event.input?.agent)) throw new Error(`Blocked: here you may start only ${settings.agents.join(", ")}.`)
      if (event.tool !== "shell") return
      if (broken || !hooked) throw new Error(`Blocked: the write sandbox does not work (${broken}), so the shell is off. Use read, grep, glob, edit and write, and report this.`)
      const command = String(event.input?.command || "")
      const why = shellVerdict(command)
      if (why) throw new Error(`Blocked: ${why}. This agent may write only inside ${root}.`)
      pending.push({ id: event.sessionID + event.id, command, started: false })
    })
    await ctx.tool.hook("execute.after", (event) => {
      if (event.tool === "shell" && covered(event.agent)) drop(event)
    })

    await ctx.permission.hook("evaluate", (event) => {
      if (event.action !== "edit" || !covered(event.agent)) return
      const deny = (message) => {
        event.effect = "deny"
        event.message = message
        log("denied edit", event.agent, JSON.stringify(event.resources).slice(0, 300))
      }
      try {
        for (const r of event.resources) {
          const full = norm(real(path.isAbsolute(r) ? r : path.join(here, r)))
          if (!allowed.some((d) => inside(full, d))) return deny(`Blocked: this agent may write only inside ${root}. Reading other places is fine.`)
          if (inside(full, rootN) && PROTECTED.test(full.slice(rootN.length))) return deny("Blocked: settings that OpenCode or git would run are off limits for this agent.")
        }
      } catch (e) {
        log("error", e?.stack || String(e))
        deny("Blocked: the path could not be checked.")
      }
    })

    // The agents are told once per session; the text never changes, so the prompt cache stays valid.
    const text = [
      "# Write sandbox",
      "You can read everything on this computer, but you can write only inside",
      [root, ...settings.alsoWritable].map((d) => d.replaceAll("\\", "/")).join(", ") + (settings.lowLabel.length ? ` (the shell also: ${settings.lowLabel.map((d) => d.replaceAll("\\", "/")).join(", ")})` : ""),
      "with `edit` and `write`. For the shell, Windows itself refuses writes elsewhere; temporary files go to $TEMP." +
        (noBash ? " The shell is PowerShell or cmd; bash is not available here." : ""),
      "\"Permission denied\" or \"Access denied\" outside the folder is this sandbox: do not try to get around it, do the work inside the folder or leave the step for the user.",
      `Files with passwords and keys cannot be opened. Commands are ended when less than ${limits.ramFreeGB} GB of memory or ${limits.diskFreeGB} GB of the drive would stay free, or when the folder with its cache grows over ${limits.folderGB} GB: keep an eye on build output.`,
      "Calls are checked before they run. A clearly harmful one, or many refused ones, stops all agents until the user comes back, so do not try variants of a refused command.",
      "Programs started from a shell call end with it; for a server use `background: true`.",
    ].join("\n")
    await ctx.session.hook("prompt", async (event) => {
      try {
        const entries = await ctx.session.instructions.entry.list({ sessionID: event.sessionID })
        if (!entries.some((e) => e.key === "sandbox")) await ctx.session.instructions.entry.put({ sessionID: event.sessionID, key: "sandbox", value: text })
      } catch (e) {
        log("error", e?.message || String(e))
      }
    })
  },
}
