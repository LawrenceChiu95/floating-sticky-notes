import { describe, expect, it, vi } from 'vitest';
import {
  createReleaseFeedbackStateStore,
  RELEASE_FEEDBACK_STATE_FILENAME
} from '../main/release-feedback-state';

describe('release feedback state storage', () => {
  it('treats a missing file as reliable empty state', async () => {
    const store = createReleaseFeedbackStateStore({
      filePath: `/user-data/${RELEASE_FEEDBACK_STATE_FILENAME}`,
      readFile: vi.fn(async () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      })
    });

    await expect(store.load()).resolves.toEqual({ kind: 'available' });
  });

  it('treats malformed or invalid state as reliable empty state and warns', async () => {
    const warnings: unknown[][] = [];
    const malformed = createReleaseFeedbackStateStore({
      filePath: '/user-data/release-feedback.json',
      readFile: vi.fn(async () => '{not-json'),
      logWarning: (...args) => warnings.push(args)
    });
    const invalid = createReleaseFeedbackStateStore({
      filePath: '/user-data/release-feedback.json',
      readFile: vi.fn(async () => JSON.stringify({ lastShownReleaseVersion: 'next' })),
      logWarning: (...args) => warnings.push(args)
    });

    await expect(malformed.load()).resolves.toEqual({ kind: 'available' });
    await expect(invalid.load()).resolves.toEqual({ kind: 'available' });
    expect(warnings).toHaveLength(2);
  });

  it('skips automatic decisions when the state cannot be read reliably', async () => {
    const store = createReleaseFeedbackStateStore({
      filePath: '/user-data/release-feedback.json',
      readFile: vi.fn(async () => {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      }),
      logWarning: vi.fn()
    });

    await expect(store.load()).resolves.toEqual({ kind: 'unavailable' });
  });

  it('persists a valid stable version without changing note data', async () => {
    const mkdir = vi.fn(async () => undefined);
    const writeFile = vi.fn(async () => undefined);
    const store = createReleaseFeedbackStateStore({
      filePath: '/user-data/release-feedback.json',
      readFile: vi.fn(async () => JSON.stringify({ lastShownReleaseVersion: '0.1.13' })),
      mkdir,
      writeFile
    });

    await expect(store.load()).resolves.toEqual({
      kind: 'available',
      lastShownReleaseVersion: '0.1.13'
    });
    await store.save('0.1.14');

    expect(mkdir).toHaveBeenCalledWith('/user-data', { recursive: true });
    expect(writeFile).toHaveBeenCalledWith(
      '/user-data/release-feedback.json',
      `${JSON.stringify({ lastShownReleaseVersion: '0.1.14' }, null, 2)}\n`,
      'utf8'
    );
  });
});
