import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { togglePopover } from '../renderer/src/note-popover';

const appSource = readFileSync(resolve(__dirname, '../renderer/src/App.tsx'), 'utf8');

describe('note popover state machine', () => {
  it('toggles the target popover open and closed', () => {
    expect(togglePopover(null, 'more')).toBe('more');
    expect(togglePopover('more', 'more')).toBeNull();
    expect(togglePopover(null, 'note-delete')).toBe('note-delete');
    expect(togglePopover('note-delete', 'note-delete')).toBeNull();
  });

  it('never allows both popovers open at once', () => {
    expect(togglePopover('more', 'note-delete')).toBe('note-delete');
    expect(togglePopover('note-delete', 'more')).toBe('more');
  });
});

describe('note popover renderer wiring', () => {
  it('drives both popovers from a single nullable state', () => {
    expect(appSource).toContain('useState<NotePopover | null>(null)');
    expect(appSource).toContain("openPopover === 'more'");
    expect(appSource).toContain("openPopover === 'note-delete'");
    expect(appSource).toContain("togglePopover(current, 'more')");
    expect(appSource).toContain("togglePopover(current, 'note-delete')");
  });

  it('wires the delete trigger through the toggle handler', () => {
    expect(appSource).toContain('onClick={handleRequestDeleteNote}');
    expect(appSource).not.toContain('setIsNoteDeleteConfirmOpen((value) => !value)');
  });

  it('moves focus into the confirmation and back to the trigger', () => {
    expect(appSource).toContain('cancelNoteDeleteButtonRef.current?.focus()');
    expect(appSource).toContain('ref={cancelNoteDeleteButtonRef}');
    expect(appSource).toContain('requestAnimationFrame(() => noteDeleteButtonRef.current?.focus())');
  });
});
