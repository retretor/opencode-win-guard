# Contributing

Thank you for helping. Bug reports, better patterns, documentation, translations and code are all welcome.

## Before you start

- **Bugs, false stops and small fixes:** open a pull request directly, or an issue first if you are not sure.
- **New features or changed behaviour:** open an issue first and describe the problem it solves, so that we agree on the approach before you spend time on code.
- **A way around the sandbox or the secret files:** do not open an issue; see [SECURITY.md](SECURITY.md).

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

You need Windows 10 or 11 and Node.js 20 or newer; for the plugin end-to-end test also [opencode](https://opencode.ai) 2.2 or newer on `PATH`. There are no npm dependencies. The launcher is built with the C# compiler of the .NET Framework 4 that comes with Windows.

```powershell
git clone https://github.com/<you>/opencode-win-guard.git
cd opencode-win-guard
git config core.hooksPath .githooks       # local branch rules, and the unit tests before a push
npm test                                  # pure parts of both plugins, any OS
cmd /c launcher\build.cmd $env:TEMP\wg-bin # build the launcher only
$env:WIN_GUARD_E2E = "1"; npm run test:e2e # the launcher, and both plugins in a real `opencode serve` with a fake model
```

The end-to-end tests use temporary folders with their own secret file and put back every label they set; they do not touch your opencode configuration or your sandbox. To try a change for real, run `install.ps1` again: it copies the plugins and rebuilds the launcher, and keeps your settings.

## Making a pull request

1. Fork the repository and create a branch from `main`: `git switch -c fix/short-description` (or `feat/...`, `docs/...`, `i18n/...`).
2. Make the change. Keep it focused: one problem per pull request.
3. Add or update tests (see the rules below).
4. Update the documentation: `README.md` and its settings table, [the security model](docs/security-model.md) if the protection changes, and a line under `## Unreleased` in `CHANGELOG.md`.
5. Run `npm test`, and the end-to-end tests if you changed the launcher, the plugins' hooks or the installer.
6. Commit with a clear message in the [Conventional Commits](https://www.conventionalcommits.org/) style: `fix: do not stop on cert.pem`, `feat: ...`, `docs: ...`, `test: ...`.
7. Push the branch to your fork and open a pull request against `main`. Fill in the template, and say on which Windows version you ran the tests.
8. CI must pass. A maintainer reviews the change. Please answer review comments with new commits rather than a force-push, so that the review stays readable. Pull requests are merged with "Squash and merge".

## Rules for this project

The guard is only useful if it fails safe. Changes are reviewed with that in mind:

- **Never fall back to full rights.** When a part is missing or fails, the shell is refused and the reason is logged.
- **Patterns need tests.** A new or changed pattern of the killswitch goes with lines in `STOPS`, `REFUSES` or `FINE` of `test/unit.test.mjs`: at least one command it must catch and one ordinary command it must not. A false stop interrupts every agent of a folder, so "stop" is only for what is clearly harmful; the rest is "refuse".
- **Nothing specific to one setup.** Defaults and lists cover common tools; anything for one program, engine or computer belongs in the settings (`lowLabel`, `env`, `secrets.txt`), not in the code.
- **No network, no dependencies.** The plugins use Node's standard library only; the launcher uses the .NET Framework only.
- **The launcher stays C# 5,** so that the compiler that ships with Windows can build it (`launcher/build.cmd` must keep working without an SDK).
- Only the default export of a plugin file is a plugin. Test helpers go into `_test`.
- Two spaces, double quotes, no semicolons in JavaScript; four spaces in C#.

## Translations

English is the main language of the project, and `README.md` is the reference. Translations live in `docs/i18n/README.<language>.md` and may lag behind: when you change `README.md`, updating them is welcome but not required. To add a language:

- for the documentation, copy `README.md` to `docs/i18n/README.<code>.md`, translate it, fix the relative links, and add it to the language line at the top of every README;
- for the stop note that the agents and the user see, add an entry to `TRANSLATIONS` in `plugins/win-guard-killswitch.js` (the `ru` entry shows every key) and mention the code under `language` in the settings table. The unit tests check that every entry has all keys.

## Branch rules

`main` is protected on GitHub: changes go in through pull requests with passing CI, history stays linear, `main` cannot be force-pushed or deleted, and release tags (`v*`) cannot be moved or deleted. The hooks in `.githooks` apply the same rules locally (no commits on `main`, no direct pushes to it) and run the unit tests before a push. `ALLOW_MAIN=1` overrides them in an emergency.

## Releases (maintainers)

1. In a pull request: move the `Unreleased` lines of `CHANGELOG.md` under a new version heading and set the same version in `package.json` (`npm version <x.y.z> --no-git-tag-version`).
2. After the merge: `git switch main`, `git pull`, `git tag v<x.y.z>`, `git push origin v<x.y.z>`.
3. The release workflow runs the tests on Windows and makes the GitHub release with the notes from the changelog and a zip of the files needed to install.

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE) of this project.
