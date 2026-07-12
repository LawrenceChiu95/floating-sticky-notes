import { describe, expect, it } from 'vitest';
import {
  applySavedNoteName,
  beginNoteNameSave,
  cancelNoteNameEditing,
  createNoteNamingState,
  failNoteNameSave,
  getNoteNameKeyAction,
  getNoteNamePresentation,
  startNoteNameEditing,
  updateNoteNameDraft
} from '../renderer/src/note-naming';

describe('note naming state', () => {
  it('starts editing the current name and can update the draft', () => {
    const state = updateNoteNameDraft(
      startNoteNameEditing(createNoteNamingState('工作')),
      '工作计划'
    );

    expect(state).toEqual({
      name: '工作',
      draft: '工作计划',
      isEditing: true,
      isSaving: false
    });
  });

  it('cancels editing and restores the name from before editing', () => {
    const editing = updateNoteNameDraft(
      startNoteNameEditing(createNoteNamingState('工作')),
      '不保存'
    );

    expect(cancelNoteNameEditing(editing)).toEqual({
      name: '工作',
      draft: '工作',
      isEditing: false,
      isSaving: false
    });
  });

  it('uses the normalized name returned by the main process after saving', () => {
    const editing = updateNoteNameDraft(
      startNoteNameEditing(createNoteNamingState('')),
      '  工作  '
    );

    expect(applySavedNoteName(editing, '工作')).toEqual({
      name: '工作',
      draft: '工作',
      isEditing: false,
      isSaving: false
    });
  });

  it('does not start a second edit while a name save is pending', () => {
    const saving = beginNoteNameSave(
      updateNoteNameDraft(startNoteNameEditing(createNoteNamingState('工作')), '工作计划')
    );

    expect(startNoteNameEditing(saving)).toBe(saving);
    expect(failNoteNameSave(saving)).toEqual({
      name: '工作',
      draft: '工作',
      isEditing: false,
      isSaving: false
    });
  });
});

describe('note naming keyboard behavior', () => {
  it('submits with Enter', () => {
    expect(getNoteNameKeyAction('Enter')).toBe('submit');
  });

  it('cancels with Escape', () => {
    expect(getNoteNameKeyAction('Escape')).toBe('cancel');
  });

  it('leaves other keys to the input', () => {
    expect(getNoteNameKeyAction('a')).toBeUndefined();
  });

  it('does not submit Enter while an input method is composing text', () => {
    expect(getNoteNameKeyAction('Enter', true)).toBeUndefined();
  });
});

describe('note naming presentation priority', () => {
  it('keeps an active editor visible when unrelated status changes', () => {
    const editing = startNoteNameEditing(createNoteNamingState('工作'));

    expect(getNoteNamePresentation(editing, '保存失败')).toEqual({ kind: 'editor' });
  });

  it('shows temporary status ahead of the saved name when not editing', () => {
    expect(getNoteNamePresentation(createNoteNamingState('工作'), '保存失败')).toEqual({
      kind: 'status',
      text: '保存失败'
    });
  });

  it('shows the editor ahead of the saved name', () => {
    const editing = startNoteNameEditing(createNoteNamingState('工作'));

    expect(getNoteNamePresentation(editing, '')).toEqual({ kind: 'editor' });
  });

  it('shows the saved name with a full-name tooltip when revealed', () => {
    expect(getNoteNamePresentation(createNoteNamingState('工作'), '')).toEqual({
      kind: 'name',
      text: '工作',
      title: '工作'
    });
  });

  it('exposes the hover hint for an empty name', () => {
    expect(getNoteNamePresentation(createNoteNamingState(''), '')).toEqual({
      kind: 'empty',
      hint: '双击命名'
    });
  });
});
