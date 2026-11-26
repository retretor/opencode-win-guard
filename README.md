# opencode-win-guard

[![CI](https://github.com/retretor/opencode-win-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/retretor/opencode-win-guard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**English** · [Русский](docs/i18n/README.ru.md)

A write sandbox and an emergency stop for [opencode](https://opencode.ai) agents on **Windows**, for letting agents work unattended in a project folder. No administrator rights, no Docker, no WSL, no network access.

![A scripted agent writes outside its folder and is refused by the plugin and by Windows, then reads a key file and stops all agents until the user writes](docs/media/demo.gif)

*A scripted agent against the real plugins and launcher in an isolated `opencode serve`.*

| Part | What it does |
|---|---|
| **Sandbox** (`win-guard-sandbox.js` + launcher) | The agents read everything, but write only inside the project folder. For `edit`/`write` the plugin checks the real path (links resolved). For the shell, **Windows itself** refuses every write, delete and rights change outside the folder: commands run with a Low integrity token, and only the project folder and a cache folder carry the Low label. |
| **Secret files** (launcher, `secrets.txt`) | Files with keys and passwords (SSH keys, cloud credentials, browser keys, opencode's own service password...) get a mandatory label that Low programs cannot read past. Your own programs are not affected. |
| **Limits** (launcher) | Every command runs in a job object: a hard memory cap that keeps a set amount of RAM free for you, a minimum of free disk space, a maximum size of project plus cache. Over a limit the command is ended (exit code 125). |
| **Killswitch** (`win-guard-killswitch.js`) | Checks every call **before it runs**: the shell command and the scripts of the project it starts (`build.ps1`, `npm test` scripts...). Clearly harmful calls (reading keys, asking Windows for saved passwords, wiping disks, turning off Defender, controlling opencode from outside...) stop **all agents of the folder** at once. Risky ones (downloading and running a script unseen, uploading files, autostart entries) are refused. A file `STOP` in the project, many refused calls, or a large part of the project's files disappearing also stop them. The stop survives a restart of opencode until you write a message. |

It protects against the mistakes of an agent and against the harmful commands it may be talked into. It is not a wall against a program written to break out: read the [security model](docs/security-model.md) before you rely on it.

## Requirements

- Windows 10 or 11, NTFS.
- opencode 2.2 or newer (V2 plugin API). Tested with opencode 2.2.3 on Windows 10 22H2.
- The C# compiler of the .NET Framework 4 (`%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`). It is part of Windows, so nothing has to be installed: the installer builds the launcher from the sources in [`launcher/`](launcher), and no prebuilt program is downloaded.
- For bash: Git for Windows. The installer copies it (about 400 MB) into the sandbox folder, because Git Bash starts at Low integrity only from a copy of its own. Without it (`-NoGit`) the agents get PowerShell and cmd.

## Install

Download the source of the [latest release](https://github.com/retretor/opencode-win-guard/releases/latest) (or clone the repository), then in PowerShell:

```powershell
cd opencode-win-guard
.\install.ps1 -Folder C:\Users\me\Projects\my-project
```

The installer builds the launcher into `~\.local\share\opencode\sandbox\bin`, copies Git, creates `secrets.txt` and `~\.config\opencode\win-guard.json` from the examples (existing ones are kept), copies the plugins into `~\.config\opencode\plugins`, and closes the files of `secrets.txt`. Then:

1. **Read `~\.local\share\opencode\sandbox\secrets.txt`** and add the files with keys and passwords of your computer. `protect.exe --list` in the `bin` folder shows what is closed.
2. Restart opencode and start a session in the project folder. The log `~\.local\share\opencode\log\win-guard.log` says `on for <folder>`.

Run `install.ps1` again to update; to remove everything, `uninstall.ps1` (`-RemoveData` also deletes the Git copy, caches and settings). If PowerShell refuses to run the script, start it with `powershell -ExecutionPolicy Bypass -File .\install.ps1 ...`.

## Settings: `~\.config\opencode\win-guard.json`

```json
{
  "folders": ["C:\\Users\\me\\Projects\\my-project"],
  "limits": { "ramFreeGB": 4, "diskFreeGB": 15, "folderGB": 15 },
  "agents": "*",
  "extraTools": [],
  "alsoWritable": [],
  "lowLabel": [],
  "env": {},
  "language": "en"
}
```

| Key | Default | Meaning |
|---|---|---|
| `folders` | (required) | Absolute paths. A session started in one of them (or below) is guarded; everywhere else nothing changes. A whole drive, your user folder or a system folder are refused. |
| `limits.ramFreeGB` | 4 | Memory that always stays free for you. A command waits up to 60 s for it to start, and is ended if free memory falls below it. |
| `limits.diskFreeGB` | 15 | Free space the drive of the folder keeps. |
| `limits.folderGB` | 15 | Largest size of the folder with its cache. |
| `agents` | `"*"` | Agents that are guarded: `"*"` for all, or a list of names. Others (your own interactive agent, say) work with full rights. With a list, a guarded agent may only start subagents of that list. |
| `extraTools` | `[]` | Tools of other plugins that the agents may use. Every tool not known to write nothing is refused, because a new plugin or MCP server would run with full rights. Add a name only if the tool writes nothing or checks its own writes, e.g. `["crew_list", "crew_send"]` for [opencode-crew-mail](https://github.com/retretor/opencode-crew-mail). |
| `alsoWritable` | `[]` | More folders that `edit` and `write` may change (not the shell). |
| `lowLabel` | `[]` | More folders that get the Low label, so that sandboxed programs can write there. Paths may start with `%APPDATA%`, `%LOCALAPPDATA%` or another environment variable. Useful for the data folder of a program built in the project: such a program runs with lowered rights (also when you start it yourself) and may fail if it cannot write its settings or saves. A missing folder is created. |
| `env` | `{}` | More environment variables for sandboxed commands, e.g. `{ "CARGO_HOME": "${cache}/cargo" }`. `${cache}` is the cache folder of the project, `${folder}` the project folder. The sandbox already moves the caches of npm, yarn, pnpm, bun, pip, uv, Poetry, Go, Gradle, NuGet and .NET there, and `TEMP`, `APPDATA` and `LOCALAPPDATA`. |
| `language` | `"en"` | Language of the stop note: `"en"` or `"ru"`. More are welcome, see [CONTRIBUTING.md](CONTRIBUTING.md#translations). |

A broken settings file does not switch the guard off: the shell is refused and the log says why.

## What the agents see

- Once per session they are told where they may write, that secret files cannot be opened, the limits, and that harmful calls stop everyone.
- A refused tool call returns `Blocked: ...` with the reason; Windows refusals show up as "Access denied" in the shell.
- Launcher exit codes: **125** a limit or `STOP` ended or prevented the command, **126** the command was not started (sandbox incomplete). The command never runs with full rights instead.
- After an emergency stop every call fails with `EMERGENCY STOP: <reason>`, the agents are interrupted (the leads first), and `AGENT_STOPPED.txt` in the project says what happened. Delete the file `STOP` if you created one, then write any message in a session of the folder.

## Stop the agents yourself

Create a file named `STOP` in the project folder. Running commands are ended within a second or two, new ones do not start, and all agents of the folder are interrupted.

## Working with other plugins

- `globalThis[Symbol.for("opencode-win-guard.halted")]` is a `Set` of the folders that are stopped (lower-case, forward slashes). A plugin that continues agents on its own (an autopilot) should look there first.
- Tools of other plugins need `extraTools`, see above.

## Why the launcher is written in C#

The sandbox needs Windows functions that no script can call directly: a restricted token with a Low integrity level, `CreateProcessAsUser`, job objects with memory limits, and mandatory labels on files. C# reaches them with plain P/Invoke, and its compiler comes with every Windows 10 and 11 as part of the .NET Framework. So the launcher is built from the readable sources on your own computer when you install, with no SDK, no download and no unsigned program from the internet. The code is limited to C# 5 so that this old compiler can build it.

## Tests

```powershell
npm test                                   # pure parts, any OS
$env:WIN_GUARD_E2E = "1"; npm run test:e2e # also the launcher and both plugins in a real `opencode serve` with a fake model
```

The end-to-end tests work in temporary folders with their own secret file, build the launcher for themselves and put back every label they set. They do not touch your opencode configuration, sessions or sandbox, and need no provider or account.

## Related projects

Found in November 2026; none of them sandboxes the shell on Windows or stops a whole session tree:

- [opencode-sandbox](https://github.com/Hamza-Abili/opencode-sandbox): an OS sandbox for the shell with bubblewrap (Linux) and Seatbelt (macOS); native Windows is not supported.
- [opencode-guard](https://github.com/gigi206/opencode-guard): rule-based deny/ask for tool calls plus an optional decision model, and redaction of secrets before they reach the model.
- [opencode-hook-safety](https://github.com/MansM/opencode-hook-safety): deny lists for secret paths and destructive commands, optional classifier.
- [opencode-damage-control](https://github.com/nicounii/opencode-damage-control): blocks 90+ dangerous command patterns, three tiers of path protection.

They work at the level of command text and paths; they combine well with this one, which adds the operating system's own refusal.

## Contributing

Bug reports, ideas and pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). Ways around the sandbox: please report them privately, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
