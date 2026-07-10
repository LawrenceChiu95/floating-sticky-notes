# Contributing

Thanks for helping improve Floating Sticky Notes.

## Before You Start

- Search existing issues before opening a new one.
- Small fixes do not require an issue first.
- Open an issue before a large feature, storage-format change, installer change, or update-system change so the direction can be agreed on before implementation.
- Report security vulnerabilities through the process in [SECURITY.md](SECURITY.md), not through a public issue.

## Development Setup

Use Node.js 22 and npm 10:

```bash
npm ci
npm run dev
```

Before submitting a pull request, run:

```bash
npm test
npm run build
npm audit --omit=dev
```

## Pull Requests

External contributors should fork the repository, create a focused branch, and open a pull request. Repository maintainers may push directly to `main`; pull requests remain available for changes that benefit from discussion or staged review.

Keep each pull request focused on one problem. Include:

- The user-visible problem and the chosen behavior
- Tests for changed behavior
- Relevant manual verification steps
- An entry under `Unreleased` in `CHANGELOG.md` for user-visible changes

Do not commit generated installers, release directories, user data, credentials, local environment files, or machine-specific paths.

## Project Boundaries

- Keep runtime `name: floating-sticky-notes`, `appId: local.lawrence.floating-sticky-notes`, and `productName: 悬浮便签` unless a migration plan explicitly handles install identity and local data.
- Keep `%APPDATA%\floating-sticky-notes` compatible across Windows updates.
- Keep automatic updates limited to packaged Windows builds.
- Do not add a portable Windows target; the updater supports the NSIS Setup installation path.
- Treat native Windows behavior as unverified until it has been checked on Windows hardware or a Windows virtual machine.

## Commit Messages

Write concise imperative messages, for example:

```text
Fix tray update status handling
Add checklist keyboard regression test
Document Windows release verification
```
