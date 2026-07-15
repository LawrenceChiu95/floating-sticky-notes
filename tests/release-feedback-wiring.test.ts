import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(resolve(__dirname, '../main/main.ts'), 'utf8');
const packageJson = JSON.parse(
  readFileSync(resolve(__dirname, '../package.json'), 'utf8')
) as { scripts?: Record<string, string> };

describe('release feedback main-process wiring', () => {
  it('captures old-install traces and initializes state before notes or startup markers are created', () => {
    const tracesIndex = mainSource.indexOf('const hadExistingInstallation =');
    const initializeIndex = mainSource.indexOf('await releaseFeedbackController.initialize()');
    const notesStartIndex = mainSource.indexOf('await notesManager.start()');
    const autoLaunchIndex = mainSource.indexOf('ensureAutoLaunchDefaultEnabled(');

    expect(tracesIndex).toBeGreaterThan(-1);
    expect(initializeIndex).toBeGreaterThan(tracesIndex);
    expect(initializeIndex).toBeLessThan(notesStartIndex);
    expect(tracesIndex).toBeLessThan(autoLaunchIndex);
    expect(mainSource).toContain("existsSync(notesPath) || existsSync(autoLaunchMarkerPath)");
  });

  it('creates the tray before showing feedback and waits before checking for updates', () => {
    const notesStartIndex = mainSource.indexOf('await notesManager.start()');
    const trayIndex = mainSource.indexOf('createTray({');
    const feedbackIndex = mainSource.indexOf(
      'await releaseFeedbackController.showAutomaticallyIfNeeded()'
    );
    const updateCheckIndex = mainSource.indexOf('void updateController.checkSilently()');

    expect(trayIndex).toBeGreaterThan(notesStartIndex);
    expect(feedbackIndex).toBeGreaterThan(trayIndex);
    expect(updateCheckIndex).toBeGreaterThan(feedbackIndex);
  });

  it('uses generated offline content and stops creating feedback when quit begins', () => {
    expect(mainSource).toContain("from './generated/release-notes'");
    expect(mainSource).toContain('releaseNotes: BUILT_RELEASE_NOTES');
    expect(mainSource).toContain('releaseFeedbackController?.beginQuit()');
    expect(mainSource).not.toContain("readFileSync('CHANGELOG.md'");
  });

  it('generates release content before both development and production builds', () => {
    expect(packageJson.scripts?.predev).toBe('node scripts/build-release-notes.cjs');
    expect(packageJson.scripts?.prebuild).toBe('node scripts/build-release-notes.cjs');
  });
});
