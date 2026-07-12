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

  it('keeps name-save feedback separate from unrelated temporary status', () => {
    expect(appSource).toContain("const [nameStatusMessage, setNameStatusMessage] = useState('')");
    expect(appSource).toContain('window.setTimeout');
    expect(appSource).toContain('statusMessage || nameStatusMessage');
    expect(appSource).toContain('}, STATUS_MESSAGE_DURATION_MS);');
    expect(appSource).toMatch(
      /if \(!statusMessage \|\| PERSISTENT_STATUS_MESSAGES\.has\(statusMessage\)\)[\s\S]*window\.setTimeout\(\(\) => \{\s*setStatusMessage\(''\);[\s\S]*STATUS_MESSAGE_DURATION_MS/
    );
    expect(appSource).toContain("const PERSISTENT_STATUS_MESSAGES = new Set(['读取失败'])");
  });

  it('briefly confirms a saved name before returning to the hidden state', () => {
    expect(appSource).toContain('isNameConfirmationVisible');
    expect(appSource).toContain('nameConfirmationTimeoutRef');
    expect(appSource).toContain('note-name-hit-area--confirming');
    expect(appSource).toContain('}, 1500)');
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
  it('keeps saved names muted, single-line, and ellipsized', () => {
    expect(styles).toMatch(/\.status-label\s*{[^}]*font-size:\s*12px;/s);
    expect(styles).toMatch(/\.status-label\s*{[^}]*text-overflow:\s*ellipsis;/s);
    expect(styles).toMatch(/\.status-label\s*{[^}]*white-space:\s*nowrap;/s);
  });

  it('keeps names hidden until the note is hovered or a save is being confirmed', () => {
    expect(styles).toMatch(/\.note-name-hit-area\s*{[^}]*-webkit-app-region:\s*no-drag;/s);
    expect(styles).toMatch(/\.note-name-hit-area\s*{[^}]*opacity:\s*0;/s);
    expect(styles).toMatch(/\.note-name-hit-area\s*{[^}]*pointer-events:\s*auto;/s);
    expect(styles).toMatch(
      /\.note-name-hit-area:hover,\s*\.note-name-hit-area--confirming\s*{[^}]*opacity:\s*1;/s
    );
    expect(styles).toMatch(/\.note-name--empty::after\s*{[^}]*content:\s*attr\(data-hint\);/s);
    expect(styles).not.toMatch(/\.note-shell:hover[^,{]*\.note-name-hit-area/);
  });

  it('uses an adaptive transparent name hit area and keeps a reliable drag grip', () => {
    expect(appSource).toContain('note-name-hit-area');
    expect(styles).toMatch(/\.drag-grip\s*{[^}]*width:\s*40px;/s);
    expect(styles).toMatch(/\.note-name-hit-area\s*{[^}]*min-width:\s*72px;/s);
    expect(styles).toMatch(/\.note-name-hit-area\s*{[^}]*max-width:\s*96px;/s);
    expect(styles).toMatch(/\.note-name-hit-area\s*{[^}]*cursor:\s*text;/s);
    expect(styles).toMatch(/\.note-name-hit-area--named\s*{[^}]*min-width:\s*0;/s);
  });

  it('uses a transparent borderless input while editing', () => {
    expect(styles).toMatch(/\.note-name-input\s*{[^}]*border:\s*0;/s);
    expect(styles).toMatch(/\.note-name-input\s*{[^}]*background:\s*transparent;/s);
  });
});
