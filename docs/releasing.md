# Releasing

Source and release artifacts use separate public repositories:

- Source, issues, and changelog: `LawrenceChiu95/floating-sticky-notes`
- Windows updater assets: `LawrenceChiu95/floating-sticky-notes-updates`

## Prepare A Version

1. Update `package.json` and `package-lock.json` to the same semantic version.
2. Move completed entries from `Unreleased` in `CHANGELOG.md` to the version and release date.
3. Run:

   ```bash
   npm ci
   npm test
   npm run build
   npm audit --omit=dev
   npm run dist:win
   ```

4. Inspect the packaged asar and verify the runtime package name, version, updater feed, and expected assets.
5. Create a draft release in the update repository and upload only:

   ```text
   latest.yml
   StickyNotes-Setup-<version>.exe
   StickyNotes-Setup-<version>.exe.blockmap
   ```

6. Verify installation, launch, tray behavior, local data retention, update detection, download, and restart installation on Windows.
7. Publish the draft only after native verification passes. Publishing the release makes `releases/latest/download/latest.yml` available to installed clients.
8. Tag the corresponding source commit and publish source release notes.

Never upload user data, local profiles, credentials, debug logs, or generated packages other than the three reviewed public update assets.

## Rollback

Keep a release as draft until verification is complete. If a published version must be withdrawn, first stop serving it as the latest release, then prepare a higher patch version with the fix. Installed clients compare semantic versions and should not rely on publishing an older version as a rollback.
