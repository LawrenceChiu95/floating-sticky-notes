import { describe, expect, it } from 'vitest';
import {
  createDownloadingSnapshot,
  createPreparingSnapshot
} from '../shared/update-progress';

describe('update progress snapshots', () => {
  it('uses an indeterminate snapshot before percentage is known', () => {
    expect(createPreparingSnapshot('0.1.11')).toEqual({
      state: 'preparing',
      version: '0.1.11'
    });
  });

  it.each([
    [{ percent: 42.4 }, 42],
    [{ percent: -5 }, 0],
    [{ percent: 105 }, 100]
  ])('normalizes valid progress %#', (input, percent) => {
    expect(createDownloadingSnapshot(input, '0.1.11')).toEqual({
      state: 'downloading',
      version: '0.1.11',
      percent
    });
  });

  it.each([undefined, {}, { percent: Number.NaN }, { percent: Infinity }])(
    'keeps invalid progress indeterminate',
    (input) => {
      expect(createDownloadingSnapshot(input, '0.1.11')).toEqual({
        state: 'downloading',
        version: '0.1.11'
      });
    }
  );
});
