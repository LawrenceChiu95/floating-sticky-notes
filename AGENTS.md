# Project Guidelines

## Read First

- `README.md`
- `CONTRIBUTING.md`
- `CHANGELOG.md`
- `docs/architecture.md`
- `docs/releasing.md`

## Non-Negotiables

- Keep runtime `name: floating-sticky-notes`, `appId: local.lawrence.floating-sticky-notes`, and `productName: 悬浮便签` unless an approved migration handles installation identity and userData consequences.
- Preserve `%APPDATA%\floating-sticky-notes` compatibility.
- Keep Windows automatic updates on the existing public generic feed.
- Do not add a portable Windows target.
- Do not reintroduce `win.signAndEditExecutable: false`; it prevents Windows executable icon resources from being written.
- Keep the global launch-at-login setting in the tray, not in each note's appearance controls.
- Diagnose Windows native failures at the process, file-lock, registry, shortcut, resource, policy, or shell-cache layer before changing code.
- Do not claim Windows-native behavior is verified from a macOS cross-build.

## Verification

Run before pushing:

```bash
npm test
npm run build
npm audit --omit=dev
git diff --check
```

For a Windows release, also run `npm run dist:win`, inspect the packaged asar, and complete the native checklist in `docs/releasing.md`.
