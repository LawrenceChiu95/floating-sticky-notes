import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_COPY, getAppCopy } from '../shared/app-copy';

describe('local app copy', () => {
  it('uses neutral copy when no local profile exists', () => {
    expect(getAppCopy()).toEqual(DEFAULT_APP_COPY);
    expect(DEFAULT_APP_COPY.noteContentPlaceholder).toBe('可以在这里随便记点什么');
    expect(DEFAULT_APP_COPY.checklistItemPlaceholder).toBe('待办事项');
  });

  it('derives local copy from a display name without embedding one', () => {
    const copy = getAppCopy('示例用户');

    expect(copy.noteContentPlaceholder).toBe('示例用户可以在这里随便记点什么');
    expect(copy.checklistItemPlaceholder).toBe('示例用户的待办事项');
  });
});
