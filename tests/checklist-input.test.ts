import { describe, expect, it } from 'vitest';
import { normalizeChecklistInput } from '../main/checklist-input';

const timestamp = '2026-07-15T00:00:00.000Z';

describe('checklist IPC input normalization', () => {
  it('preserves a valid one-level parent relationship', () => {
    expect(
      normalizeChecklistInput([
        createInput('parent'),
        { ...createInput('child'), parentId: 'parent' }
      ])
    ).toEqual([
      createInput('parent'),
      { ...createInput('child'), parentId: 'parent' }
    ]);
  });

  it('clears malformed and orphaned parent relationships without rejecting the list', () => {
    expect(
      normalizeChecklistInput([
        createInput('parent'),
        { ...createInput('bad-type'), parentId: 42 },
        { ...createInput('orphan'), parentId: 'missing' }
      ])
    ).toEqual([
      createInput('parent'),
      createInput('bad-type'),
      createInput('orphan')
    ]);
  });

  it('still rejects malformed required item fields', () => {
    expect(normalizeChecklistInput([{ ...createInput('bad'), text: 42 }])).toBeUndefined();
  });
});

function createInput(id: string): {
  id: string;
  text: string;
  checked: boolean;
  createdAt: string;
  updatedAt: string;
} {
  return {
    id,
    text: id,
    checked: false,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}
