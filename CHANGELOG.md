# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

## 0.1.0 - 2026-11-26

- Sandbox plugin: `edit`/`write` only inside the configured folders (links resolved), unknown tools refused, `extraTools` for exceptions.
- Launcher: every shell command runs with a Low integrity token in a job object (memory cap, free disk, folder size, `STOP` file); exit codes 125 and 126.
- Secret files from `secrets.txt` closed for Low programs (`protect.exe --apply/--undo/--list`); a command that names one of them stops the agents.
- Caches of common tools (npm, yarn, pnpm, bun, pip, uv, Poetry, Go, Gradle, NuGet, .NET) moved into a cache folder the sandbox may write; `env` adds more variables, `lowLabel` more writable folders.
- Killswitch plugin: checks shell commands and the project scripts they start before they run; harmful calls stop all agents of the folder, the stop survives a restart until the user writes. Stop note in English or Russian.
- `install.ps1` / `uninstall.ps1`, no administrator rights needed.
- Unit tests, a launcher test and an end-to-end test of both plugins in a real `opencode serve` with a fake model.
