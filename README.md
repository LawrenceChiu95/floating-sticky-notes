# Floating Sticky Notes

<img src="assets/icons/app-icon.png" alt="Floating Sticky Notes icon" width="128">

Floating Sticky Notes is a small Electron desktop app for keeping local notes visible above ordinary windows. The current interface is in Chinese, and Windows is the primary supported platform.

## Features

- Multiple always-on-top sticky-note windows
- Plain text and checklists
- Clipboard paste, screenshot paste, and image drag-and-drop
- Per-note color and opacity controls
- Window size and position restoration
- Local JSON and image storage with no account, cloud service, or telemetry
- System tray controls and optional launch at login
- In-app Windows update checks through a public GitHub Release feed

## Project Status

Version `0.1.9` is the first public source release and the first version with the Windows updater. The Windows installer remains in draft until native installation and update checks have completed on a Windows machine.

The updater reads release assets from [`floating-sticky-notes-updates`](https://github.com/LawrenceChiu95/floating-sticky-notes-updates). Source code, issues, and change history live in this repository.

## Run From Source

Requirements:

- Node.js 22
- npm 10

```bash
npm ci
npm run dev
```

Run the automated checks:

```bash
npm test
npm run build
npm audit --omit=dev
```

## Build Packages

Build the Windows x64 NSIS Setup package:

```bash
npm run dist:win
```

Build the unsigned Apple Silicon macOS DMG on macOS:

```bash
npm run dist:mac
```

Windows releases use the Setup installer only. Portable builds are not supported by the automatic updater.

## Local Data

The app stores notes and imported images on the local computer:

- Windows: `%APPDATA%\floating-sticky-notes`
- macOS: `~/Library/Application Support/floating-sticky-notes`

Installing an update does not delete this directory. Uninstalling also leaves local notes in place unless they are removed manually.

## Contributing

Bug reports, feature ideas, and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting code. Security issues should follow [SECURITY.md](SECURITY.md).

Architecture and release details are documented in [`docs/architecture.md`](docs/architecture.md) and [`docs/releasing.md`](docs/releasing.md).

## License

MIT. See [LICENSE](LICENSE).
