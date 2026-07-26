import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(resolve(__dirname, '../renderer/src/App.tsx'), 'utf8');
const styles = readFileSync(resolve(__dirname, '../renderer/src/styles.css'), 'utf8');
const mainSource = readFileSync(resolve(__dirname, '../main/main.ts'), 'utf8');

function countTopBarToolButtons(): number {
  const toolbarStart = appSource.indexOf('<div className="toolbar"');
  const toolbarEnd = appSource.indexOf('</div>', toolbarStart);
  return appSource.slice(toolbarStart, toolbarEnd).match(/<button/g)?.length ?? 0;
}

function getRuleBody(source: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(
    new RegExp(`(?:^|\\n)\\s*${escapedSelector}\\s*\\{([^}]*)\\}`, 's')
  );

  if (!match) {
    throw new Error(`Missing CSS rule: ${selector}`);
  }

  return match[1];
}

function getPixelProperty(ruleBody: string, property: string): number {
  const match = ruleBody.match(
    new RegExp(`${property}:\\s*(\\d+)(?:px)?(?:\\s+[^;]+)?;`)
  );

  if (!match) {
    throw new Error(`Missing pixel property: ${property}`);
  }

  return Number(match[1]);
}

function getInlinePadding(ruleBody: string): number {
  const fourValueMatch = ruleBody.match(
    /padding:\s*\d+(?:px)?\s+(\d+)(?:px)?\s+\d+(?:px)?\s+(\d+)(?:px)?;/
  );

  if (fourValueMatch) {
    return Number(fourValueMatch[1]) + Number(fourValueMatch[2]);
  }

  const twoValueMatch = ruleBody.match(/padding:\s*\d+(?:px)?\s+(\d+)px;/);

  if (twoValueMatch) {
    return Number(twoValueMatch[1]) * 2;
  }

  const leftMatch = ruleBody.match(/padding-left:\s*(\d+)px;/);
  const rightMatch = ruleBody.match(/padding-right:\s*(\d+)px;/);

  if (!leftMatch || !rightMatch) {
    throw new Error('Missing inline pixel padding');
  }

  return Number(leftMatch[1]) + Number(rightMatch[1]);
}

function computeNameTextBudget(windowWidth: number, compact: boolean): number {
  const compactStart = styles.indexOf('@media (max-width: 220px)');
  const compactEnd = styles.indexOf('\n}\n\n.toolbar button:hover', compactStart) + 2;
  const metricStyles = compact ? styles.slice(compactStart, compactEnd) : styles;
  const borderWidth = getPixelProperty(getRuleBody(styles, '.note-shell'), 'border') * 2;
  const dragBarPadding = getInlinePadding(getRuleBody(metricStyles, '.drag-bar'));
  const dragGripWidth = getPixelProperty(getRuleBody(metricStyles, '.drag-grip'), 'width');
  const toolButtonWidth = getPixelProperty(getRuleBody(metricStyles, '.toolbar button'), 'width');
  const toolbarGap = getPixelProperty(getRuleBody(metricStyles, '.toolbar'), 'gap');
  const actionGap = getPixelProperty(getRuleBody(metricStyles, '.drag-bar-actions'), 'gap');
  const collapseToggleWidth = getPixelProperty(
    getRuleBody(metricStyles, '.collapse-toggle'),
    'width'
  );
  const namePadding = getInlinePadding(getRuleBody(styles, '.note-name-hit-area'));
  const toolButtonCount = countTopBarToolButtons();

  return (
    windowWidth -
    borderWidth -
    dragBarPadding -
    dragGripWidth -
    toolButtonCount * toolButtonWidth -
    Math.max(0, toolButtonCount - 1) * toolbarGap -
    actionGap -
    collapseToggleWidth -
    namePadding
  );
}

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
    expect(appSource).not.toContain('className="note-name" title=');
  });

  it('uses an adaptive transparent name hit area and keeps a reliable drag grip', () => {
    expect(appSource).toContain('note-name-hit-area');
    expect(styles).toMatch(/\.drag-grip\s*{[^}]*width:\s*28px;/s);
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

  it('reserves enough measured width for the full empty-name hint', () => {
    const fullHintWidth = 4 * 12;

    expect(countTopBarToolButtons()).toBe(4);
    expect(computeNameTextBudget(280, false)).toBeGreaterThanOrEqual(fullHintWidth);
    expect(computeNameTextBudget(200, true)).toBeGreaterThanOrEqual(fullHintWidth);
    expect(styles).toMatch(/\.toolbar button\s*{[^}]*width:\s*26px;/s);
    expect(styles).toMatch(
      /@media \(max-width: 220px\)[\s\S]*\.toolbar button\s*{[^}]*width:\s*20px;/s
    );
    expect(appSource).toContain('title="双击命名"');
  });

  it('lets the name editor reclaim the toolbar width in both shell states', () => {
    expect(appSource).toContain("noteNaming.isEditing ? ' note-shell--naming' : ''");
    expect(styles).toMatch(
      /\.note-shell--naming \.toolbar-wrap\s*{[^}]*grid-template-columns:\s*0fr;[^}]*opacity:\s*0;/s
    );
    expect(styles).toMatch(/\.note-shell--naming \.note-name-input\s*{[^}]*width:\s*100%;/s);
    expect(styles).not.toMatch(/\.note-shell--naming \.collapse-toggle/);
  });

  it('animates collapsed naming from the displayed name into the shared editor', () => {
    expect(appSource).toContain('currentTarget.getBoundingClientRect().width');
    expect(appSource).toContain("'--collapsed-name-edit-start-width':");
    expect(appSource).not.toContain('--collapsed-name-edit-start-indent');
    expect(styles).toMatch(
      /\.note-shell--collapsed\.note-shell--naming \.collapsed-title \.note-name-input\s*{[^}]*animation:\s*collapsed-name-editor-enter 200ms cubic-bezier\(0\.33, 0\.75, 0\.35, 1\) backwards;/s
    );
    expect(styles).toMatch(
      /@keyframes collapsed-name-editor-enter\s*{[\s\S]*?from\s*{[^}]*width:\s*var\(--collapsed-name-edit-start-width\);[^}]*}[\s\S]*?to\s*{[^}]*width:\s*var\(--note-name-max-width\);[^}]*}/s
    );
    expect(styles).not.toMatch(/@keyframes collapsed-name-editor-enter[\s\S]*?text-indent:/s);
  });

  it('lets the collapsed bar host naming instead of the app brand', () => {
    // Unnamed notes stay blank in the collapsed bar instead of showing 悬浮便签.
    expect(appSource).toContain('const collapsedLabel = statusMessage || noteNaming.name;');
    expect(appSource).not.toContain("noteNaming.name || '悬浮便签'");
    // Once the fold settles, the collapsed bar reuses the shared presentation
    // (status / editor / named chip / empty hint) with the same input ref.
    expect(appSource).toMatch(
      /isCollapsed && !isCollapseTransitioning\s*\?\s*\(\s*renderNamePresentationContent\(\)\s*\)\s*:/
    );
    expect(appSource).toContain('const renderNamePresentationContent = (): ReactNode => (');
    // Both presentations center the display name and editor in their current
    // title track; the collapsed track compensates for asymmetric chrome.
    expect(styles).toMatch(/\.status-label\s*{[^}]*text-align:\s*center;/s);
    expect(styles).toMatch(/\.status-label\s*{[^}]*padding:\s*0;/s);
    expect(styles).toMatch(/\.note-name-hit-area\s*{[^}]*justify-content:\s*center;/s);
    expect(styles).toMatch(/\.note-name-hit-area\s*{[^}]*padding:\s*0 6px;/s);
    expect(styles).toMatch(/\.note-name-input\s*{[^}]*text-align:\s*center;/s);
    expect(styles).toMatch(/\.collapsed-title\s*{[^}]*justify-content:\s*center;/s);
    expect(styles).not.toMatch(/\.collapsed-title \.note-name-hit-area\s*{/s);
    expect(styles).not.toMatch(/\.collapsed-title \.note-name-input\s*{[^}]*padding:/s);
    expect(styles).not.toMatch(/\.collapsed-title \.note-name-input\s*{[^}]*text-align:/s);
    expect(styles).toMatch(/\.collapsed-title\s*{[^}]*--note-name-min-width:\s*min\(72px,\s*100%\);/s);
    expect(styles).toMatch(/\.collapsed-title\s*{[^}]*--note-name-max-width:\s*min\(160px,\s*100%\);/s);
    expect(styles).toMatch(/\.collapsed-title \.note-name-input\s*{[^}]*pointer-events:\s*auto;/s);
    expect(styles).toMatch(/\.collapsed-title\s*{[^}]*pointer-events:\s*none;/s);
    expect(styles).toMatch(
      /\.note-shell--collapse-transitioning \.status-label\s*{[^}]*justify-self:\s*start;[^}]*width:\s*var\(--note-transition-title-width\);/s
    );
    expect(appSource).toContain(
      "isCollapseTransitioning ? ' note-shell--collapse-transitioning' : ''"
    );
    expect(appSource).toContain('expandedStatusLabelWidthRef.current = expandedStatusLabelWidth;');
    expect(appSource).toContain("'--note-transition-title-width':");
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
