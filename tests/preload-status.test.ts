import { describe, expect, it } from 'vitest';
import { getPreloadStatus } from '../renderer/src/preload-status';

describe('getPreloadStatus', () => {
  it('reports ready when the preload bridge exposes a platform', () => {
    expect(getPreloadStatus({ stickyNotes: { platform: 'darwin' } })).toBe('ready:darwin');
  });

  it('reports missing when the preload bridge is unavailable', () => {
    expect(getPreloadStatus({})).toBe('missing');
  });
});
