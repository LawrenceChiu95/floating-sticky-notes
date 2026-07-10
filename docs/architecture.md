# Architecture

## Process Boundaries

Floating Sticky Notes uses Electron with context isolation enabled and Node integration disabled in renderer windows.

- `main/`: window lifecycle, persistence, image storage, tray integration, launch-at-login, and updates
- `preload/`: the narrow IPC bridge exposed to the renderer
- `renderer/`: React note UI and editing interactions
- `shared/`: logic shared by the main and renderer processes

Renderer windows do not read arbitrary local files or call Node APIs directly. Image imports and note persistence cross validated IPC handlers in the main process.

## Data Model And Storage

Notes are stored in `notes.json` under Electron's `userData` directory. Imported images are stored in the adjacent `images/` directory, while note records retain only image references and dimensions.

Writes are debounced and serialized. Pending renderer content, window bounds, and storage operations are flushed before application exit and before updater installation. Invalid records are normalized or skipped so one damaged note does not prevent application startup.

For compatibility with existing installations, the main process can read an optional `personalization.json` file from `userData` and derive local placeholder copy from its `displayName`. The repository and public installers do not create or bundle this file. A missing or invalid file falls back to neutral copy.

## Window And Tray Lifecycle

Each note has its own frameless, transparent `BrowserWindow`. Restored bounds are constrained to an available display. Closing the final note does not terminate the Windows application because the tray remains active; the tray Exit action performs a real persistence flush and process exit.

## Automatic Updates

Updates are enabled only when both conditions are true:

- `process.platform === 'win32'`
- `app.isPackaged === true`

`electron-updater` reads the generic feed at:

```text
https://github.com/LawrenceChiu95/floating-sticky-notes-updates/releases/latest/download
```

The application checks silently after startup. Manual tray checks report whether an update is available. Download and restart installation require user confirmation, and note persistence is flushed before `quitAndInstall` runs.

macOS and development builds do not instantiate the updater.
