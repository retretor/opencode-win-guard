# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

## 0.2.0 - 2026-11-26

- `doctor.ps1` (installed into the sandbox folder): checks the installation, the Low labels, a real command through the launcher and the closed files; shows whether the agents are stopped and the last refusals; `-Why "<command>"` tells what the plugins would do with a command.
- `"killswitch": "watch"`: the checks of commands and file texts only write what they would have done to the log, to try them on real work first. Reading a file of `secrets.txt` with `read`, `grep` or `webfetch`, and a file `STOP`, still stop the agents.
- Fix: a folder setting of only a drive letter (`D:`) was not refused as a whole drive when the current folder was on that drive.
- Demo GIF in the README; the link to opencode-sandbox points to the original repository instead of a fork.
- README translations and the stop note in Simplified Chinese, Japanese, Korean, Spanish, Brazilian Portuguese, German and French (`language`: `zh-CN`, `ja`, `ko`, `es`, `pt-BR`, `de`, `fr`).

## 0.1.0 - 2026-11-26

- Sandbox plugin: `edit`/`write` only inside the configured folders (links resolved), unknown tools refused, `extraTools` for exceptions.
- Launcher: every shell command runs with a Low integrity token in a job object (memory cap, free disk, folder size, `STOP` file); exit codes 125 and 126.
- Secret files from `secrets.txt` closed for Low programs (`protect.exe --apply/--undo/--list`); a command that names one of them stops the agents.
- Caches of common tools (npm, yarn, pnpm, bun, pip, uv, Poetry, Go, Gradle, NuGet, .NET) moved into a cache folder the sandbox may write; `env` adds more variables, `lowLabel` more writable folders.
- Killswitch plugin: checks shell commands and the project scripts they start before they run; harmful calls stop all agents of the folder, the stop survives a restart until the user writes. Stop note in English or Russian.
- `install.ps1` / `uninstall.ps1`, no administrator rights needed.
- Unit tests, a launcher test and an end-to-end test of both plugins in a real `opencode serve` with a fake model.
