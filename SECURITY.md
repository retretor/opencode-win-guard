# Security policy

What the guard protects against and what it does not is described in the [security model](docs/security-model.md), with its known gaps. Please read it before you report: a gap listed there is known.

## Supported versions

Fixes go into the latest release only.

## Reporting a vulnerability

Please do not open a public issue, and do not publish working code that gets around the guard before a fix is out. Report it privately through [GitHub's private vulnerability reporting](https://github.com/retretor/opencode-win-guard/security/advisories/new) with:

- what can be done (for example: write outside the project folder, read a file of `secrets.txt`, start a program with full rights, switch the guard off), and the steps or the command;
- the versions of Windows, opencode and opencode-win-guard, and whether bash (the Git copy) was used;
- the relevant lines of `~\.local\share\opencode\log\win-guard.log`, with private paths removed.

You get an answer within a week. Once the problem is confirmed, a fix and a security advisory follow, and you are credited unless you prefer not to be.

## In scope

- A sandboxed command that writes, deletes or changes rights outside the project, its cache and the configured folders.
- A sandboxed command, or a read tool of an agent, that opens a file listed in `secrets.txt`.
- A command that runs with full rights although the sandbox is on, or a fallback to full rights when a part is missing.
- A way for an agent to change or switch off the plugins, their settings or the launcher.
- A killswitch stop that can be released without a message of the user.

## Out of scope

- The gaps listed in the [security model](docs/security-model.md), such as reading files that are not in `secrets.txt`, network access, Windows Credential Manager, or drives without Windows rights.
- A harmful command that the text checks do not recognise but that the sandbox stops: please open an ordinary issue for better patterns.
