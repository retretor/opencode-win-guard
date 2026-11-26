# Security model and known gaps

## What it is for

An agent that works for hours without anyone watching makes mistakes (deletes the wrong folder, overwrites a file elsewhere, fills the disk) and can be talked into harmful commands by text it reads (a web page, a README, an issue). opencode-win-guard limits the damage of both:

- **Writes** outside the project are refused by Windows for everything the shell starts, whatever language or program does it. This is the strong part: it does not depend on recognising a command.
- **Secret files** in `secrets.txt` cannot be opened by those programs. Also enforced by Windows.
- **Text checks** before a call runs stop or refuse what is clearly harmful. This is the weak part: it sees what a command says, not what it does.
- **Limits** for memory, disk and folder size, enforced by a job object and by polling.

## What it is not

It is not a wall against code written to escape. Treat it as a seat belt, not as a vault, and keep the usual habits: version control (commit often, the guard makes no backup), no secrets in the project, an agent with no more tools than it needs.

## Known gaps

1. **Reading is free.** Apart from the files in `secrets.txt`, a sandboxed program can read whatever you can read, and the network is open. An agent could read a file and send it somewhere. Upload commands (`curl -T`, `scp`, `Invoke-WebRequest -InFile`...) are refused by the text check only; a compiled or obfuscated program is not seen. Keep everything secret in `secrets.txt`.
2. **`secrets.txt` must be complete.** A file not on the list is open. The example covers common places, not your computer. In particular keep the `!` lines for opencode's `service.json`: with the service password a program could control opencode through its local API, outside the sandbox.
3. **Windows Credential Manager** (`cmdkey`, `CredRead`) can be read from Low integrity by a compiled program. Only the commands that name it are stopped.
4. **Drives without Windows rights** (FAT, exFAT: most USB sticks) and `AppData\LocalLow` are writable by Low programs. Commands that name another drive or LocalLow are refused by text; a compiled program is not seen.
5. **Tools other than the shell run inside opencode with your full rights.** `edit` and `write` are checked by path (links resolved), `read`/`grep` of secret files is refused by the killswitch, and every unknown tool is refused (`extraTools` adds exceptions). A plugin or MCP server you allow there is trusted completely.
6. **The plugins live in the opencode process.** Anything that can change your opencode configuration or plugins can switch them off. The sandbox refuses writes to opencode's settings (`.opencode`, `opencode.json`) inside the project, and the shell cannot write to `~\.config\opencode`.
7. **Mass deletion is noticed after about 2 seconds** and stops the agents, but what is gone is gone. Only folders with files you would miss are counted (build output, caches and similar are skipped).
8. **Labels persist.** The project folder and the `lowLabel` folders keep their Low label after the session; programs built there also run with lowered rights when you start them yourself. `uninstall.ps1` resets the labels it set.
9. **Limits are approximate.** Memory is capped for the job; disk and folder size are polled, so a fast writer can pass a limit by a little before it is ended.
10. **The text checks have false positives and negatives.** A refused harmless command can be done another way or left as a step for you; a harmful one in disguise may pass the text check (and then meets the sandbox).

## Reporting a problem

A way around the sandbox or the secret files is a vulnerability: please report it privately, see [SECURITY.md](../SECURITY.md). Other false stops and misses of the text checks are ordinary bugs: open an issue with the exact command, the Windows and opencode versions, and the relevant lines of `win-guard.log`.
