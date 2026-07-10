# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Public repository infrastructure, contribution guidance, issue forms, and CI.

## [0.1.9] - 2026-07-11

### Added

- Multiple always-on-top note windows with local persistence.
- Plain text, editable checklists, note colors, and opacity controls.
- Clipboard images, screenshot paste, image drag-and-drop, and image deletion.
- System tray actions for creating notes, launch-at-login, update checks, and exit.
- Windows automatic update checks using `electron-updater` and a generic GitHub Release feed.
- Existing local profile compatibility without bundling profile data in the source or public installer.
- Windows x64 NSIS Setup and unsigned Apple Silicon macOS packaging commands.

### Changed

- Windows distribution uses one neutral Setup package and no portable target.
- Long note content scrolls inside the note while the toolbar remains accessible.

### Fixed

- Pending note data is flushed before exit and before an updater-triggered restart.
- Image deletion restores the previous editing focus without a native modal dialog.
- Restored window bounds are constrained to an available display.

[Unreleased]: https://github.com/LawrenceChiu95/floating-sticky-notes/compare/v0.1.9...HEAD
[0.1.9]: https://github.com/LawrenceChiu95/floating-sticky-notes/releases/tag/v0.1.9
