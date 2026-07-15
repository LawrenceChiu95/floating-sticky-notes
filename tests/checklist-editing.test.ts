import { describe, expect, it } from 'vitest';
import {
  applyChecklistAddSubtask,
  applyChecklistBackspace,
  applyChecklistDelete,
  applyChecklistEnter,
  applyChecklistIndent,
  applyChecklistOutdent,
  getChecklistKeyAction,
  getChecklistShortcutHint,
  normalizeChecklistText,
  type ChecklistFocusTarget
} from '../renderer/src/checklist-editing';
import { setChecklistParent } from '../main/checklist-hierarchy';
import type { NoteChecklistItemRecord } from '../main/note-state';

describe('checklist text normalization', () => {
  it('keeps each checklist item single-paragraph when multiline text is pasted', () => {
    expect(normalizeChecklistText('第一行\n第二行\r\n第三行')).toBe('第一行第二行第三行');
  });
});

describe('checklist keyboard actions', () => {
  it('ignores shortcuts while an IME composition is active', () => {
    expect(getChecklistKeyAction('Enter', true)).toBeUndefined();
    expect(getChecklistKeyAction('Backspace', true)).toBeUndefined();
    expect(getChecklistKeyAction('Tab', true)).toBeUndefined();
  });

  it('maps Enter, Backspace, Tab, and Shift+Tab after composition ends', () => {
    expect(getChecklistKeyAction('Enter')).toBe('enter');
    expect(getChecklistKeyAction('Backspace')).toBe('backspace');
    expect(getChecklistKeyAction('Tab')).toBe('indent');
    expect(getChecklistKeyAction('Tab', false, true)).toBe('outdent');
  });

  it('ignores unrelated keys', () => {
    expect(getChecklistKeyAction('Escape')).toBeUndefined();
  });
});

describe('checklist keyboard editing', () => {
  it('shows contextual hierarchy hints only for valid level changes', () => {
    const first = createItem('first', '第一项');
    const parent = createItem('parent', '目标');
    const child = createItem('child', '步骤', 'parent');
    const next = createItem('next', '下一项');

    expect(getChecklistShortcutHint([first], 'first')).toBeUndefined();
    expect(getChecklistShortcutHint([first, next], 'next')).toBe('indent');
    expect(getChecklistShortcutHint([parent, child], 'child')).toBe('outdent');
    expect(getChecklistShortcutHint([parent, child, next], 'parent')).toBeUndefined();
  });

  it('inserts a new top-level item after a parent group', () => {
    const parent = createItem('parent', '目标');
    const child = createItem('child', '步骤', 'parent');
    const next = createItem('next', '后来');

    expect(applyChecklistEnter([parent, child, next], 'parent', createOptions('new'))).toEqual({
      checklist: [parent, child, createItem('new', ''), next],
      focus: { type: 'checklist', itemId: 'new' } satisfies ChecklistFocusTarget
    });
  });

  it('inserts another child after the current child', () => {
    const parent = createItem('parent', '目标');
    const child = createItem('child', '步骤', 'parent');

    expect(applyChecklistEnter([parent, child], 'child', createOptions('new'))).toEqual({
      checklist: [parent, child, createItem('new', '', 'parent')],
      focus: { type: 'checklist', itemId: 'new' } satisfies ChecklistFocusTarget
    });
  });

  it('deletes an empty child and focuses its parent on Enter', () => {
    const parent = createItem('parent', '目标');
    const child = createItem('child', '', 'parent');

    expect(applyChecklistEnter([parent, child], 'child', createOptions('unused'))).toEqual({
      checklist: [parent],
      focus: { type: 'checklist', itemId: 'parent' } satisfies ChecklistFocusTarget
    });
  });

  it('deletes an empty top-level item and focuses the note body on Enter', () => {
    const first = createItem('first', '保留');
    const empty = createItem('empty', '');

    expect(applyChecklistEnter([first, empty], 'empty', createOptions('unused'))).toEqual({
      checklist: [first],
      focus: { type: 'note' } satisfies ChecklistFocusTarget
    });
  });

  it('deletes an empty item and focuses the previous visible item on Backspace', () => {
    const parent = createItem('parent', '目标');
    const child = createItem('child', '', 'parent');
    const next = createItem('next', '下一项');

    expect(applyChecklistBackspace([parent, child, next], 'child')).toEqual({
      checklist: [parent, next],
      focus: { type: 'checklist', itemId: 'parent' } satisfies ChecklistFocusTarget
    });
  });

  it('indents below a parent or joins the previous child group', () => {
    const parent = createItem('parent', '目标');
    const firstChild = createItem('child', '步骤', 'parent');
    const next = createItem('next', '下一步');

    expect(applyChecklistIndent([parent, next], 'next').checklist).toEqual([
      parent,
      { ...next, parentId: 'parent' }
    ]);
    expect(applyChecklistIndent([parent, firstChild, next], 'next').checklist).toEqual([
      parent,
      firstChild,
      { ...next, parentId: 'parent' }
    ]);
  });

  it('does not indent the first item, an existing child, or a parent with children', () => {
    const parent = createItem('parent', '目标');
    const child = createItem('child', '步骤', 'parent');
    const next = createItem('next', '下一项');

    expect(applyChecklistIndent([parent, child, next], 'parent').checklist).toEqual([
      parent,
      child,
      next
    ]);
    expect(applyChecklistIndent([parent, child, next], 'child').checklist).toEqual([
      parent,
      child,
      next
    ]);
  });

  it('outdents a child after its former parent block', () => {
    const parent = createItem('parent', '目标');
    const firstChild = createItem('first', '第一步', 'parent');
    const secondChild = createItem('second', '第二步', 'parent');

    expect(applyChecklistOutdent([parent, firstChild, secondChild], 'first').checklist).toEqual([
      parent,
      secondChild,
      setChecklistParent(firstChild)
    ]);
  });
});

describe('checklist structure editing', () => {
  it('adds an empty child at the end of the selected parent group', () => {
    const parent = createItem('parent', '目标');
    const child = createItem('child', '步骤', 'parent');
    const next = createItem('next', '下一项');

    expect(applyChecklistAddSubtask([parent, child, next], 'parent', createOptions('new'))).toEqual({
      checklist: [parent, child, createItem('new', '', 'parent'), next],
      focus: { type: 'checklist', itemId: 'new' }
    });
  });

  it('promotes children in order when deleting their parent', () => {
    const parent = createItem('parent', '目标');
    const checkedChild = { ...createItem('first', '第一步', 'parent'), checked: true };
    const secondChild = createItem('second', '第二步', 'parent');

    expect(applyChecklistDelete([parent, checkedChild, secondChild], 'parent')).toEqual([
      setChecklistParent(checkedChild),
      setChecklistParent(secondChild)
    ]);
  });

  it('deletes one child without changing its parent or siblings', () => {
    const parent = createItem('parent', '目标');
    const firstChild = createItem('first', '第一步', 'parent');
    const secondChild = createItem('second', '第二步', 'parent');

    expect(applyChecklistDelete([parent, firstChild, secondChild], 'first')).toEqual([
      parent,
      secondChild
    ]);
  });
});

function createOptions(id: string): { createId: () => string; now: () => string } {
  return {
    createId: () => id,
    now: () => '2026-07-06T01:00:00.000Z'
  };
}

function createItem(id: string, text: string, parentId?: string): NoteChecklistItemRecord {
  return {
    id,
    text,
    checked: false,
    ...(parentId ? { parentId } : {}),
    createdAt: parentId || text === '' ? '2026-07-06T01:00:00.000Z' : '2026-07-06T00:00:00.000Z',
    updatedAt: parentId || text === '' ? '2026-07-06T01:00:00.000Z' : '2026-07-06T00:00:00.000Z'
  };
}
