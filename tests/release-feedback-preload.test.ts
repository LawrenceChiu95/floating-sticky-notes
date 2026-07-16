import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const preloadSource = readFileSync(
  resolve(__dirname, '../preload/release-feedback-preload.ts'),
  'utf8'
);

describe('release feedback preload boundary', () => {
  it('exposes only snapshot subscription, rendered reporting and dismissal', () => {
    expect(preloadSource).toContain("exposeInMainWorld('releaseFeedback'");
    expect(preloadSource).toContain('onSnapshot');
    expect(preloadSource).toContain('reportRendered');
    expect(preloadSource).toContain('dismiss');
    expect(preloadSource).toContain('ipcRenderer.on(RELEASE_FEEDBACK_CHANNELS.snapshot');
    expect(preloadSource).toContain('ipcRenderer.send(RELEASE_FEEDBACK_CHANNELS.rendered');
    expect(preloadSource).toContain('ipcRenderer.send(RELEASE_FEEDBACK_CHANNELS.dismiss');
    expect(preloadSource).not.toContain('sticky-notes:');
    expect(preloadSource).not.toContain('update-progress:');
    expect(preloadSource).not.toContain('ipcRenderer.invoke');
  });
});
