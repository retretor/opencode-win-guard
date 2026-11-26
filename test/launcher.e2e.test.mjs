// The launcher on a real Windows: builds it into a temporary folder and runs PowerShell through it.
// Runs only with WIN_GUARD_E2E=1. Changes nothing outside its temporary folders, and opens the test file again at the end.
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"
import { spawnSync, execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const skip = process.platform !== "win32" ? "Windows only" : process.env.WIN_GUARD_E2E === "1" ? false : "set WIN_GUARD_E2E=1 to run"
const PS = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
const ICACLS = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "icacls.exe")

test("launcher: writes only in the folder, secrets closed, limits, STOP", { skip, timeout: 180000 }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "win-guard-launcher-"))
  const home = path.join(root, "sandbox")
  const bin = path.join(home, "bin")
  const proj = path.join(root, "project")
  const outside = path.join(root, "outside")
  const secret = path.join(root, "secret", "key.txt")
  for (const d of [bin, proj, outside, path.dirname(secret)]) fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(secret, "not for the agents")
  fs.writeFileSync(path.join(home, "secrets.txt"), `# test\r\n!${secret}\r\n`)
  execFileSync("cmd.exe", ["/c", path.join(HERE, "..", "launcher", "build.cmd"), bin], { stdio: "ignore" })
  execFileSync(ICACLS, [proj, "/setintegritylevel", "(OI)(CI)low"], { stdio: "ignore" })
  const protect = (arg) => execFileSync(path.join(bin, "protect.exe"), [arg], { encoding: "utf8" })

  const base = { ...process.env, OPENCODE_SANDBOX_SHELL: PS, OPENCODE_SANDBOX_FOLDERS: proj, OPENCODE_SANDBOX_RAM_FREE_MB: "128", OPENCODE_SANDBOX_DISK_FREE_MB: "0", OPENCODE_SANDBOX_FOLDERS_MAX_MB: "100000" }
  const run = (command, env = {}) => {
    const r = spawnSync(path.join(bin, "powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", command], { cwd: proj, env: { ...base, ...env }, encoding: "utf8", timeout: 60000 })
    return { code: r.status, out: (r.stdout || "") + (r.stderr || "") }
  }
  try {
    let r = run("Set-Content inside.txt 1; 'wrote'")
    assert.equal(r.code, 0, r.out)
    assert.ok(fs.existsSync(path.join(proj, "inside.txt")), "a write inside the folder works")

    r = run(`try { Set-Content '${path.join(outside, "x.txt")}' 1 -ErrorAction Stop; 'WROTE' } catch { 'denied' }`)
    assert.match(r.out, /denied/)
    assert.ok(!fs.existsSync(path.join(outside, "x.txt")), "Windows refuses a write outside the folder")

    r = run(`try { [IO.File]::ReadAllText('${secret}'); 'READ' } catch { 'refused' }`)
    assert.match(r.out, /refused/, "the secret file is closed to the sandbox")
    assert.equal(fs.readFileSync(secret, "utf8"), "not for the agents", "and still open to the user")
    assert.match(protect("--list"), /^closed {2}/m)

    r = run("'x'", { OPENCODE_SANDBOX_RAM_FREE_MB: "99999999", OPENCODE_SANDBOX_RAM_WAIT_MS: "0" })
    assert.equal(r.code, 125, r.out)
    assert.match(r.out, /MB of memory are free/)

    fs.writeFileSync(path.join(proj, "STOP"), "")
    r = run("'x'")
    assert.equal(r.code, 125, r.out)
    assert.match(r.out, /STOP/)
    fs.rmSync(path.join(proj, "STOP"))

    r = run("'x'", { OPENCODE_SANDBOX_SHELL: "" })
    assert.equal(r.code, 126, "without a shell nothing runs")

    assert.match(protect("--undo"), /^open again {2}/m)
    assert.match(protect("--list"), /^OPEN {2}/m)
  } finally {
    try {
      protect("--undo")
    } catch {}
    try {
      execFileSync(ICACLS, [proj, "/setintegritylevel", "(OI)(CI)medium", "/T", "/C", "/Q"], { stdio: "ignore" })
    } catch {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  }
})

test("doctor.ps1 on an installation in temporary folders", { skip, timeout: 180000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "win-guard-doctor-"))
  const home = path.join(root, "sandbox")
  const cfg = path.join(root, "config", "opencode")
  const proj = path.join(root, "project")
  const secret = path.join(root, "secret", "key.txt")
  for (const d of [path.join(home, "bin"), path.join(cfg, "plugins"), proj, path.dirname(secret)]) fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(secret, "not for the agents")
  fs.writeFileSync(path.join(home, "secrets.txt"), `!${secret}\r\n`)
  fs.copyFileSync(path.join(HERE, "..", "launcher", "bashenv.sh"), path.join(home, "bashenv.sh"))
  execFileSync("cmd.exe", ["/c", path.join(HERE, "..", "launcher", "build.cmd"), path.join(home, "bin")], { stdio: "ignore" })
  for (const p of ["win-guard-sandbox.js", "win-guard-killswitch.js"]) fs.copyFileSync(path.join(HERE, "..", "plugins", p), path.join(cfg, "plugins", p))
  fs.writeFileSync(path.join(cfg, "win-guard.json"), JSON.stringify({ folders: [proj], limits: { ramFreeGB: 0.25, diskFreeGB: 0, folderGB: 100 } }))
  fs.writeFileSync(path.join(proj, "build.ps1"), "cmdkey /list\r\n")
  // What the sandbox plugin does when a session starts in the folder: a cache folder, both with the Low label.
  const real = fs.realpathSync.native(proj)
  const hash = crypto.createHash("sha1").update(path.resolve(real).replaceAll("\\", "/").toLowerCase()).digest("hex").slice(0, 8)
  const cache = path.join(home, "cache", `project-${hash}`)
  fs.mkdirSync(cache, { recursive: true })
  for (const d of [proj, cache]) execFileSync(ICACLS, [d, "/setintegritylevel", "(OI)(CI)low"], { stdio: "ignore" })
  execFileSync(path.join(home, "bin", "protect.exe"), ["--apply"], { stdio: "ignore" })

  const doctor = (...more) =>
    spawnSync(PS, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(HERE, "..", "doctor.ps1"), "-Folder", proj, "-ConfigDir", cfg, "-SandboxHome", home, ...more], {
      env: { ...process.env, XDG_DATA_HOME: path.join(root, "data"), OPENCODE_WIN_GUARD_CONFIG: "" },
      encoding: "utf8",
      timeout: 120000,
    })
  try {
    let r = doctor("-Why", "powershell -File build.ps1")
    const out = r.stdout + r.stderr
    assert.equal(r.status, 0, out)
    // whoami may fail inside the sandbox on some machines (GitHub runners); then doctor only warns.
    assert.match(out, /ok {4}commands run at Low integrity|WARN {2}could not read the integrity level/)
    assert.doesNotMatch(out, /did not run at Low integrity/)
    assert.match(out, /ok {4}the command may write to the cache/)
    assert.match(out, /ok {4}Windows refuses its writes outside the folder/)
    assert.match(out, /ok {4}it cannot read a closed file/)
    assert.match(out, /STOP of all agents: it asks Windows or a program for saved passwords \(in build\.ps1\)/)

    fs.mkdirSync(path.join(home, "stopped"))
    fs.writeFileSync(path.join(home, "stopped", `project-${hash}.json`), JSON.stringify({ reason: "it wipes disks or backups", by: "build", time: "now" }))
    r = doctor()
    assert.equal(r.status, 1, "a stop is reported as a problem")
    assert.match(r.stdout, /FAIL {2}the agents are STOPPED since now: it wipes disks/)
  } finally {
    try {
      execFileSync(path.join(home, "bin", "protect.exe"), ["--undo"], { stdio: "ignore" })
    } catch {}
    for (const d of [proj, cache])
      try {
        execFileSync(ICACLS, [d, "/setintegritylevel", "(OI)(CI)medium", "/T", "/C", "/Q"], { stdio: "ignore" })
      } catch {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  }
})
