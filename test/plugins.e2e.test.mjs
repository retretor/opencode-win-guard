// Both plugins inside a real `opencode serve`, with a scripted fake model and a launcher built for the test.
// Windows only, needs opencode >= 2.2 on PATH, runs only with WIN_GUARD_E2E=1. Uses temporary folders only;
// your own opencode configuration, sessions and sandbox are not touched.
//
// 1. The agent writes outside its folder with `write` (denied), writes inside and outside with the shell (Windows refuses
//    the second), then reads a secret file: the killswitch stops it and leaves a note. A message of the user releases it.
// 2. With "killswitch": "watch" a harmful command and file text only go to the log; reading the secret file still stops.
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { spawn, execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PASSWORD = "win-guard-test"
const skip = process.platform !== "win32" ? "Windows only" : process.env.WIN_GUARD_E2E === "1" ? false : "set WIN_GUARD_E2E=1 to run (needs opencode on PATH)"
const ICACLS = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "icacls.exe")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const freePort = () =>
  new Promise((ok) => {
    const s = http.createServer().listen(0, "127.0.0.1", () => {
      const p = s.address().port
      s.close(() => ok(p))
    })
  })

function fakeModel(script, requests) {
  let i = 0
  return http.createServer((req, res) => {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      if (req.method !== "POST") return res.writeHead(200, { "content-type": "application/json" }).end('{"data":[]}')
      const b = JSON.parse(body)
      requests.push(b)
      const r = !b.tools ? { text: "Title" } : script[i++] ?? { text: "end of script" }
      res.writeHead(200, { "content-type": "text/event-stream", connection: "close" })
      const base = { id: "x", object: "chat.completion.chunk", model: "fake" }
      const ev = (o) => res.write(`data: ${JSON.stringify({ ...base, ...o })}\n\n`)
      if (r.tool) ev({ choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: `call_${requests.length}`, type: "function", function: { name: r.tool[0], arguments: JSON.stringify(r.tool[1]) } }] }, finish_reason: null }] })
      else ev({ choices: [{ index: 0, delta: { role: "assistant", content: r.text }, finish_reason: null }] })
      ev({ choices: [{ index: 0, delta: {}, finish_reason: r.tool ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })
      res.end("data: [DONE]\n\n")
    })
  })
}

// Temporary opencode, sandbox and project; `script(paths)` gives the steps of the fake model, `body(rig)` runs the checks.
async function withOpencode(settings, script, body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "win-guard-e2e-"))
  const cfg = path.join(root, "config", "opencode")
  const home = path.join(root, "sandbox")
  const proj = path.join(root, "project")
  const outside = path.join(root, "outside")
  const secret = path.join(root, "secret", "key.txt")
  const log = path.join(root, "data", "opencode", "log", "win-guard.log")
  for (const d of [path.join(cfg, "plugins"), path.join(cfg, "agents"), path.join(home, "bin"), proj, outside, path.dirname(secret)]) fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(secret, "not for the agents")
  fs.writeFileSync(path.join(home, "secrets.txt"), `!${secret}\r\n`)
  fs.copyFileSync(path.join(HERE, "..", "launcher", "bashenv.sh"), path.join(home, "bashenv.sh"))
  execFileSync("cmd.exe", ["/c", path.join(HERE, "..", "launcher", "build.cmd"), path.join(home, "bin")], { stdio: "ignore" })
  for (const p of ["win-guard-sandbox.js", "win-guard-killswitch.js"]) fs.copyFileSync(path.join(HERE, "..", "plugins", p), path.join(cfg, "plugins", p))
  fs.writeFileSync(path.join(cfg, "win-guard.json"), JSON.stringify({ folders: [proj], limits: { ramFreeGB: 0.25, diskFreeGB: 0, folderGB: 100 }, ...settings }))

  const requests = []
  const model = fakeModel(script({ proj, outside, secret }), requests)
  const modelPort = await freePort()
  await new Promise((ok) => model.listen(modelPort, "127.0.0.1", ok))
  const m = { name: "fake", type: "chat", capabilities: { tools: true, input: ["text"], output: ["text"] }, limit: { context: 100000, output: 4000 } }
  fs.writeFileSync(
    path.join(cfg, "opencode.json"),
    JSON.stringify({ model: "fake/fake", default_agent: "lead", share: "disabled", update: "disable", providers: { fake: { package: "@opencode/ai/providers/openai-compatible", name: "fake", settings: { baseURL: `http://127.0.0.1:${modelPort}/v1`, apiKey: "none" }, models: { fake: m } } } }),
  )
  const allow = ["read", "edit", "shell", "glob", "grep", "list", "external_directory"].map((a) => `  - { action: ${a}, resource: "*", effect: allow }`).join("\n")
  fs.writeFileSync(path.join(cfg, "agents", "lead.md"), `---\ndescription: lead of the test\nmode: primary\npermissions:\n  - { action: question, resource: "*", effect: deny }\n${allow}\n---\nTEST-LEAD\n`)

  const port = await freePort()
  const env = { ...process.env, XDG_CONFIG_HOME: path.join(root, "config"), XDG_DATA_HOME: path.join(root, "data"), XDG_STATE_HOME: path.join(root, "state"), XDG_CACHE_HOME: path.join(root, "cache"), OPENCODE_SANDBOX_HOME: home, OPENCODE_SERVER_PASSWORD: PASSWORD, OPENCODE_DISABLE_MODELS_FETCH: "1" }
  for (const k of ["SHELL", "OPENCODE_CONFIG_DIR", "OPENCODE_WIN_GUARD_CONFIG"]) delete env[k] // PowerShell, as for most Windows users
  const server = spawn(`opencode serve --port ${port} --hostname 127.0.0.1`, { env, cwd: proj, shell: true, stdio: "ignore" })
  const url = `http://127.0.0.1:${port}`
  const headers = { authorization: "Basic " + Buffer.from(`opencode:${PASSWORD}`).toString("base64"), "content-type": "application/json" }
  const api = async (method, p, b) => {
    const r = await fetch(url + p, { method, headers, body: b ? JSON.stringify(b) : undefined })
    const t = await r.text()
    assert.ok(r.ok, `${method} ${p}: ${r.status} ${t.slice(0, 300)}`)
    return t ? JSON.parse(t) : {}
  }
  const idle = async (min = 3) => {
    for (let i = 0; i < 90; i++) {
      await sleep(1000)
      if (i >= min && !Object.keys((await api("GET", "/api/session/active")).data ?? {}).length) return
    }
    throw new Error("the session did not come to rest")
  }
  const results = () => requests.filter((b) => b.tools).flatMap((b) => b.messages.filter((x) => x.role === "tool").map((x) => JSON.stringify(x.content)))
  try {
    for (let i = 0; ; i++) {
      try {
        await fetch(url + "/")
        break
      } catch {
        if (i > 120) throw new Error("opencode serve did not start")
        await sleep(500)
      }
    }
    const s = await api("POST", "/api/session", { agent: "lead", model: { providerID: "fake", id: "fake" }, location: { directory: proj } })
    const id = (s.data ?? s).id
    const prompt = async (text) => {
      await api("POST", `/api/session/${id}/prompt`, { text })
      await idle()
    }
    await body({ prompt, results, proj, outside, home, log })
  } finally {
    try {
      execFileSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" })
    } catch {}
    model.close()
    await sleep(800)
    try {
      execFileSync(path.join(home, "bin", "protect.exe"), ["--undo"], { stdio: "ignore" })
    } catch {}
    for (const d of [proj, path.join(home, "cache")])
      try {
        execFileSync(ICACLS, [d, "/setintegritylevel", "(OI)(CI)medium", "/T", "/C", "/Q"], { stdio: "ignore" })
      } catch {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  }
}

test("sandbox and killswitch in opencode", { skip, timeout: 240000 }, async () => {
  const out = (outside, n) => path.join(outside, n)
  const script = ({ outside, secret }) => [
    { tool: ["write", { path: out(outside, "by-tool.txt"), content: "x" }] },
    { tool: ["shell", { command: "Set-Content inside.txt 1; 'wrote inside'", description: "inside" }] },
    { tool: ["shell", { command: `try { Set-Content '${out(outside, "by-shell.txt")}' 1 -ErrorAction Stop; 'WROTE OUTSIDE' } catch { 'denied outside' }`, description: "outside" }] },
    { tool: ["read", { path: secret }] },
    { text: "stopped. STATUS: BLOCKED" },
    { tool: ["shell", { command: "'after the release'", description: "after" }] },
    { text: "done" },
  ]
  await withOpencode({}, script, async ({ prompt, results, proj, outside, home }) => {
    await prompt("start")
    const all = results().join("\n")
    assert.match(all, /may write only inside/, "write outside the folder is denied")
    assert.ok(!fs.existsSync(out(outside, "by-tool.txt")))
    assert.ok(fs.existsSync(path.join(proj, "inside.txt")), "the shell writes inside")
    assert.match(all, /wrote inside/)
    assert.match(all, /denied outside/, "Windows refuses the shell's write outside")
    assert.ok(!fs.existsSync(out(outside, "by-shell.txt")))
    assert.match(all, /EMERGENCY STOP: it opens a file with keys or passwords/, "reading the secret stops the agents")
    assert.ok(fs.existsSync(path.join(proj, "AGENT_STOPPED.txt")), "the note is in the project")
    assert.equal(fs.readdirSync(path.join(home, "stopped")).length, 1, "the stop is saved")

    await prompt("go on")
    assert.match(results().join("\n"), /after the release/, "a message of the user releases the stop")
    assert.ok(!fs.existsSync(path.join(proj, "AGENT_STOPPED.txt")))
  })
})

test("killswitch in watch mode: commands and file texts only go to the log, secret files still stop", { skip, timeout: 240000 }, async () => {
  const script = ({ proj, secret }) => [
    // The name alone matches the check for password tools; the command only prints text.
    { tool: ["shell", { command: "'mimikatz'; 'ran'", description: "names a password tool" }] },
    { tool: ["write", { path: path.join(proj, "tool.ps1"), content: "cmdkey /list\n" }] },
    { tool: ["shell", { command: "'still going'", description: "after" }] },
    { tool: ["read", { path: secret }] },
    { text: "stopped. STATUS: BLOCKED" },
  ]
  await withOpencode({ killswitch: "watch" }, script, async ({ prompt, results, proj, log }) => {
    await prompt("start")
    const all = results().join("\n")
    assert.match(all, /ran/, "the command was not refused")
    assert.doesNotMatch(all, /Blocked for unattended agents/)
    assert.ok(fs.existsSync(path.join(proj, "tool.ps1")), "the file was written")
    assert.match(all, /still going/, "the agent went on")
    assert.match(all, /EMERGENCY STOP: it opens a file with keys or passwords/, "reading a file of secrets.txt still stops the agents")
    const text = fs.readFileSync(log, "utf8")
    assert.match(text, /\[killswitch\] watching \(nothing is refused or stopped\)/)
    assert.match(text, /WATCH would stop lead shell it asks Windows or a program for saved passwords/)
    assert.match(text, /WATCH would refuse lead write the text of the file is not allowed/)
  })
})
