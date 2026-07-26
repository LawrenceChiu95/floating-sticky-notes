import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(resolve(__dirname, '../renderer/src/App.tsx'), 'utf8');
const styles = readFileSync(resolve(__dirname, '../renderer/src/styles.css'), 'utf8');

describe('sticky note more menu wiring', () => {
  it('keeps frequent actions visible and moves low-frequency actions into a labeled menu', () => {
    expect(appSource).toContain('aria-label="更多"');
    expect(appSource).toContain('aria-haspopup="menu"');
    expect(appSource).toContain('aria-expanded={isMoreMenuOpen}');
    expect(appSource).toContain('role="menu"');
    expect(appSource.match(/role="menuitem"\s+tabIndex=\{-1\}/g)).toHaveLength(2);
    expect(appSource).toContain('外观');
    expect(appSource).toContain('从剪贴板贴图');
    expect(appSource).not.toContain('role="separator"');
  });

  it('keeps note deletion on the toolbar with an inline paper confirmation', () => {
    expect(appSource).toContain('className="note-delete-button"');
    expect(appSource).toContain('aria-label="删除便签"');
    expect(appSource).toContain('aria-expanded={isNoteDeleteConfirmOpen}');
    expect(appSource).not.toContain("window.confirm('删除这张便签？')");
    expect(appSource).toContain('role="dialog"');
    expect(appSource).toContain('aria-label="确认删除便签"');
    expect(appSource).toContain('note-delete-confirm--danger');
    expect(appSource).toContain('handleConfirmDeleteNote');
    expect(appSource).toContain('handleCancelDeleteNote');
    expect(appSource).toContain('window.stickyNotes.deleteCurrentNote()');
  });

  it('teaches the existing platform paste shortcut without hiding empty-clipboard feedback', () => {
    expect(appSource).toContain("window.stickyNotes.platform === 'darwin' ? '⌘V' : 'Ctrl+V'");
    expect(appSource).toContain('handlePasteImageMenuItem');
    expect(appSource).toContain(
      "result.reason === 'empty-clipboard' ? '剪贴板没有图片' : '贴图失败'"
    );
    expect(appSource).toContain('onPaste={handlePaste}');
    expect(appSource).toContain('onDrop={handleDropImage}');
  });

  it('supports keyboard navigation, escape focus return, and outside-click dismissal', () => {
    expect(appSource).toContain("event.key === 'ArrowDown'");
    expect(appSource).toContain("event.key === 'ArrowUp'");
    expect(appSource).toContain("event.key === 'Home'");
    expect(appSource).toContain("event.key === 'End'");
    expect(appSource).toContain("event.key === 'Escape'");
    expect(appSource).toContain('moreMenuButtonRef.current?.focus()');
    expect(appSource).toContain("document.addEventListener('pointerdown', handleOutsidePointerDown)");
    expect(appSource).toContain(
      "document.removeEventListener('pointerdown', handleOutsidePointerDown)"
    );
  });

  it('only dismisses the popover that is actually open on pointerdown', () => {
    const handlerStart = appSource.indexOf('const handleOutsidePointerDown');
    const handlerEnd = appSource.indexOf(
      "document.addEventListener('pointerdown', handleOutsidePointerDown)",
      handlerStart
    );
    const handlerSource = appSource.slice(handlerStart, handlerEnd);

    expect(handlerSource).toContain("if (openPopover === 'more')");
    expect(handlerSource).toContain("if (openPopover === 'note-delete')");
    expect(handlerSource).toContain('setOpenPopover(null)');
    expect(handlerSource).not.toContain('setIsMoreMenuOpen(false)');
    expect(handlerSource).not.toContain('setIsNoteDeleteConfirmOpen(false)');
  });

  it('keeps the menu inside the window chrome and closes it before collapse or naming', () => {
    expect(styles).toMatch(/\.drag-bar-actions\s*{[^}]*position:\s*relative;/s);
    expect(styles).toMatch(/\.more-menu\s*{[^}]*position:\s*absolute;[^}]*right:\s*31px;/s);
    expect(styles).toMatch(/\.more-menu\s*{[^}]*-webkit-app-region:\s*no-drag;/s);
    expect(appSource).toContain(
      'setIsAppearanceOpen(false);\n    setIsMoreMenuOpen(false);\n    setIsNoteDeleteConfirmOpen(false);\n    isNameEditingRef.current = true;'
    );
    expect(appSource).toContain(
      'setIsAppearanceOpen(false);\n          setIsMoreMenuOpen(false);\n          setIsNoteDeleteConfirmOpen(false);'
    );
  });
});
