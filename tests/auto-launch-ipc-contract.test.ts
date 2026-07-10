import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(resolve(__dirname, '../main/main.ts'), 'utf8');
const preloadSource = readFileSync(resolve(__dirname, '../preload/preload.ts'), 'utf8');
const globalTypes = readFileSync(resolve(__dirname, '../renderer/src/global.d.ts'), 'utf8');
const appSource = readFileSync(resolve(__dirname, '../renderer/src/App.tsx'), 'utf8');

describe('auto launch IPC contract', () => {
  it('registers main-process handlers for reading and changing startup state', () => {
    expect(mainSource).toContain("'sticky-notes:get-auto-launch-status'");
    expect(mainSource).toContain("'sticky-notes:set-auto-launch-enabled'");
  });

  it('applies startup default once from the main process before the tray reads it', () => {
    expect(mainSource).toContain('ensureAutoLaunchDefaultEnabled(app');
    expect(mainSource.indexOf('ensureAutoLaunchDefaultEnabled(app')).toBeLessThan(
      mainSource.indexOf('createTray({')
    );
  });

  it('exposes auto launch methods through the preload bridge and renderer types', () => {
    expect(preloadSource).toContain('getAutoLaunchStatus');
    expect(preloadSource).toContain('setAutoLaunchEnabled');
    expect(globalTypes).toContain('getAutoLaunchStatus: () => Promise<AutoLaunchStatus>');
    expect(globalTypes).toContain(
      'setAutoLaunchEnabled: (enabled: boolean) => Promise<AutoLaunchStatus>'
    );
  });

  it('does not render the global startup switch inside the per-note renderer', () => {
    expect(appSource).not.toMatch(/window\.stickyNotes\s*\.\s*getAutoLaunchStatus\(\)/);
    expect(appSource).not.toMatch(/window\.stickyNotes\s*\.\s*setAutoLaunchEnabled/);
    expect(appSource).not.toContain('aria-label="开机自启"');
  });
});
