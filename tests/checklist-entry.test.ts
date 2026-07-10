import { describe, expect, it } from 'vitest';
import { getChecklistAddLabel, shouldShowChecklistAddEntry } from '../renderer/src/checklist-entry';

describe('checklist entry label', () => {
  it('uses the supplied local copy when there are no checklist items', () => {
    expect(shouldShowChecklistAddEntry(0)).toBe(true);
    expect(getChecklistAddLabel(0, '小明的待办事项')).toBe('+ 小明的待办事项');
  });

  it('hides the bottom entry when checklist items already exist', () => {
    expect(shouldShowChecklistAddEntry(1)).toBe(false);
    expect(getChecklistAddLabel(1, '小明的待办事项')).toBeUndefined();
  });
});
