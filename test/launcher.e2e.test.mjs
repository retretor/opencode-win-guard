// The launcher on a real Windows: builds it into a temporary folder and runs PowerShell through it.
// Runs only with WIN_GUARD_E2E=1. Changes nothing outside its temporary folders, and opens the test file again at the end.
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
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
