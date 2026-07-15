import { describe, expect, it } from 'vitest';
import {
  applyChecklistBackspace,
  applyChecklistEnter,
  getChecklistKeyAction,
  normalizeChecklistText,
  type ChecklistFocusTarget
} from '../renderer/src/checklist-editing';
import type { NoteChecklistItemRecord } from '../main/note-state';

describe('checklist text normalization', () => {
  it('keeps each checklist item single-paragraph when multiline text is pasted', () => {
    expect(normalizeChecklistText('第一行\n第二行\r\n第三行')).toBe('第一行第二行第三行');
  });
});

describe('checklist keyboard actions', () => {
  it('ignores Enter and Backspace while an IME composition is active', () => {
    expect(getChecklistKeyAction('Enter', true)).toBeUndefined();
    expect(getChecklistKeyAction('Backspace', true)).toBeUndefined();
  });

  it('handles Enter and Backspace after the IME composition ends', () => {
    expect(getChecklistKeyAction('Enter', false)).toBe('enter');
    expect(getChecklistKeyAction('Backspace', false)).toBe('backspace');
  });

  it('ignores unrelated keys', () => {
    expect(getChecklistKeyAction('Tab')).toBeUndefined();
  });
});

describe('checklist keyboard editing', () => {
  it('inserts a new empty item after a non-empty item when pressing Enter', () => {
    const first = createItem('item-1', '修 bug');
    const second = createItem('item-2', '回归');

    expect(
      applyChecklistEnter([first, second], 'item-1', {
        createId: () => 'item-new',
        now: () => '2026-07-06T01:00:00.000Z'
      })
    ).toEqual({
      checklist: [
        first,
        {
          id: 'item-new',
          text: '',
          checked: false,
          createdAt: '2026-07-06T01:00:00.000Z',
          updatedAt: '2026-07-06T01:00:00.000Z'
        },
        second
      ],
      focus: {
        type: 'checklist',
        itemId: 'item-new'
      } satisfies ChecklistFocusTarget
    });
  });

  it('deletes an empty item and focuses the note body when pressing Enter', () => {
    const first = createItem('item-1', '修 bug');
    const empty = createItem('item-empty', '');

    expect(
      applyChecklistEnter([first, empty], 'item-empty', {
        createId: () => 'unused',
        now: () => '2026-07-06T01:00:00.000Z'
      })
    ).toEqual({
      checklist: [first],
      focus: {
        type: 'note'
      } satisfies ChecklistFocusTarget
    });
  });

  it('deletes an empty item and focuses the previous item when pressing Backspace', () => {
    const first = createItem('item-1', '修 bug');
    const empty = createItem('item-empty', '');
    const third = createItem('item-3', '回归');

    expect(applyChecklistBackspace([first, empty, third], 'item-empty')).toEqual({
      checklist: [first, third],
      focus: {
        type: 'checklist',
        itemId: 'item-1'
      } satisfies ChecklistFocusTarget
    });
  });
});

function createItem(id: string, text: string): NoteChecklistItemRecord {
  return {
    id,
    text,
    checked: false,
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z'
  };
}
