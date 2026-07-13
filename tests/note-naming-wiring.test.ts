import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(resolve(__dirname, '../renderer/src/App.tsx'), 'utf8');
const styles = readFileSync(resolve(__dirname, '../renderer/src/styles.css'), 'utf8');
const mainSource = readFileSync(resolve(__dirname, '../main/main.ts'), 'utf8');

describe('note naming renderer wiring', () => {
  it('loads the saved name and sends edits through the existing bridge', () => {
    expect(appSource).toContain("createNoteNamingState(note?.name ?? '')");
    expect(appSource).toMatch(/window\.stickyNotes\s*\.updateName\(draft\)/s);
    expect(appSource).toContain('applySavedNoteName');
  });

  it('supports double-click editing, Enter, blur, Escape, and a sixty-character input limit', () => {
    expect(appSource).toContain('onDoubleClick={handleStartNameEditing}');
    expect(appSource).toContain('onKeyDown={handleNameKeyDown}');
    expect(appSource).toContain('onBlur={handleNameSubmit}');
    expect(appSource).toContain('event.nativeEvent.isComposing');
    expect(appSource).toContain('isNameSavingRef.current');
    expect(appSource).toContain('limitNoteNameLength');
    expect(appSource).not.toContain('maxLength={MAX_NOTE_NAME_LENGTH}');
  });

  it('keeps the editor mounted while saving and exposes failure accessibly', () => {
    expect(appSource).toContain('aria-busy={noteNaming.isSaving}');
    expect(appSource).toContain('aria-invalid={noteNaming.hasSaveError}');
    expect(appSource).toContain('note-name-input--error');
    expect(appSource).toContain('name-save-error');
    expect(appSource).toContain('保存失败');
    expect(appSource).not.toContain('isNameConfirmationVisible');
    expect(appSource).not.toContain('nameConfirmationTimeoutRef');
    expect(appSource).not.toContain('note-name-hit-area--confirming');
  });

  it('prevents duplicate submits while a name save is pending', () => {
    expect(appSource).toContain('if (!isNameEditingRef.current || isNameSavingRef.current)');
    expect(appSource).toContain('readOnly={noteNaming.isSaving}');
  });

  it('does not let unrelated status block name-input focus', () => {
    expect(appSource).toContain('if (!noteNaming.isEditing)');
    expect(appSource).not.toContain('if (!noteNaming.isEditing || statusMessage)');
  });

  it('does not steal focus after a blurred name save fails', () => {
    expect(appSource).not.toContain(
      'requestAnimationFrame(() => nameInputRef.current?.focus())'
    );
  });

  it('does not reveal names from whole-note hover state', () => {
    expect(appSource).not.toContain('isNoteHovered');
    expect(appSource).not.toContain('onMouseEnter={() => setIsNoteHovered(true)}');
    expect(appSource).not.toContain('note-name-hit-area--revealed');
  });

  it('protects the main-process window title from the renderer document title', () => {
    expect(mainSource).toContain("noteWindow.on('page-title-updated'");
    expect(mainSource).toContain('event.preventDefault()');
  });

  it('does not add an independent title field above the note body', () => {
    expect(appSource).not.toContain('note-title-row');
    expect(appSource).not.toContain('便签标题');
  });
});

describe('note naming styles', () => {
  it('uses the approved quiet hierarchy for saved names', () => {
    expect(styles).toMatch(
      /\.note-name-hit-area--named\s+\.note-name\s*{[^}]*color:\s*rgba\(43, 42, 39, 0\.82\);/s
    );
    expect(styles).toMatch(
      /\.note-name-hit-area--named\s+\.note-name\s*{[^}]*font-weight:\s*600;/s
    );
    expect(appSource).toContain('className="status-message"');
    expect(styles).not.toMatch(/\.status-label\s*{[^}]*text-overflow:\s*ellipsis;/s);
    expect(styles).toMatch(/\.status-message\s*{[^}]*text-overflow:\s*ellipsis;/s);
    expect(styles).toMatch(/\.status-message\s*{[^}]*white-space:\s*nowrap;/s);
  });

  it('keeps saved names visible and empty hints hover-only', () => {
    expect(styles).toMatch(/\.note-name-hit-area\s*{[^}]*-webkit-app-region:\s*no-drag;/s);
    expect(styles).toMatch(/\.note-name-hit-area\s*{[^}]*opacity:\s*0;/s);
    expect(styles).toMatch(/\.note-name-hit-area\s*{[^}]*pointer-events:\s*auto;/s);
    expect(styles).toMatch(
      /\.note-name-hit-area:hover\s*{[^}]*background:\s*rgba\(43, 42, 39, 0\.07\);/s
    );
    expect(styles).toMatch(/\.note-name-hit-area--named\s*{[^}]*opacity:\s*1;/s);
    expect(styles).toMatch(/\.note-name--empty::after\s*{[^}]*content:\s*attr\(data-hint\);/s);
    expect(styles).not.toMatch(/\.note-shell:hover[^,{]*\.note-name-hit-area/);
  });

  it('uses an adaptive transparent name hit area and keeps a reliable drag grip', () => {
    expect(appSource).toContain('note-name-hit-area');
    expect(styles).toMatch(/\.drag-grip\s*{[^}]*width:\s*40px;/s);
    expect(styles).toMatch(
      /\.status-label\s*{[^}]*--note-name-min-width:\s*min\(72px,\s*100%\);/s
    );
    expect(styles).toMatch(
      /\.status-label\s*{[^}]*--note-name-max-width:\s*min\(160px,\s*100%\);/s
    );
    expect(styles).toMatch(
      /\.note-name-hit-area\s*{[^}]*min-width:\s*var\(--note-name-min-width\);/s
    );
    expect(styles).toMatch(
      /\.note-name-hit-area\s*{[^}]*max-width:\s*var\(--note-name-max-width\);/s
    );
    expect(styles).toMatch(/\.note-name-hit-area\s*{[^}]*cursor:\s*text;/s);
    expect(styles).not.toMatch(/\.note-name-hit-area--named\s*{[^}]*min-width:/s);
  });

  it('leaves room for five Chinese characters at the default window width', () => {
    expect(styles).toMatch(/\.status-label\s*{[^}]*padding:\s*0;/s);
    expect(styles).toMatch(/\.status-message\s*{[^}]*padding:\s*0 7px;/s);
    expect(styles).toMatch(/\.note-name-hit-area\s*{[^}]*padding:\s*0 6px;/s);
    expect(styles).toMatch(/\.note-name-input\s*{[^}]*padding:\s*0 6px;/s);
  });

  it('keeps editing typography aligned with the saved name', () => {
    expect(styles).toMatch(/\.note-name-input\s*{[^}]*border:\s*0;/s);
    expect(styles).toMatch(
      /\.note-name-input\s*{[^}]*background:\s*rgba\(43, 42, 39, 0\.07\);/s
    );
    expect(styles).toMatch(/\.note-name-input\s*{[^}]*font-size:\s*12px;/s);
    expect(styles).toMatch(/\.note-name-input\s*{[^}]*font-weight:\s*600;/s);
    expect(styles).toMatch(/\.note-name-input\s*{[^}]*field-sizing:\s*content;/s);
    expect(styles).toMatch(/\.note-name-input\s*{[^}]*width:\s*auto;/s);
    expect(styles).toMatch(
      /\.note-name-input\s*{[^}]*min-width:\s*var\(--note-name-min-width\);/s
    );
    expect(styles).toMatch(
      /\.note-name-input\s*{[^}]*max-width:\s*var\(--note-name-max-width\);/s
    );
    expect(styles).toMatch(
      /\.note-name-input--error\s*{[^}]*outline:\s*1px solid rgba\(185, 28, 28, 0\.55\);/s
    );
  });
});
