import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(resolve(__dirname, '../renderer/src/App.tsx'), 'utf8');
const styles = readFileSync(resolve(__dirname, '../renderer/src/styles.css'), 'utf8');

describe('checklist subtasks wiring', () => {
  it('renders parent and child tasks as native nested lists', () => {
    expect(appSource).toContain('<ul className="checklist" aria-label="勾选事项">');
    expect(appSource).toContain('<ul className="checklist-children" aria-label="子任务">');
    expect(appSource).toContain('checklistGroups.map(({ parent, children })');
  });

  it('keeps each parent row and its add-subtask control in one hover region', () => {
    expect(appSource).toContain('<ChecklistItemRow');
    expect(appSource).toContain('isParent');
    expect(appSource).toContain('className="checklist-add checklist-add--subtask"');
    expect(appSource).toContain('onAddSubtask={handleAddChecklistSubtask}');
    expect(appSource).toContain("item.text.trim() || '此事项'");
    expect(appSource).toContain('title="添加子任务（Tab）"');
    expect(appSource).toContain('按 Tab 创建子任务');
    expect(appSource).toContain('按 Shift+Tab 取消子任务层级');
  });

  it('places row actions before the textarea so Tab shortcuts do not trap keyboard users', () => {
    const rowSource = appSource.slice(appSource.indexOf('function ChecklistItemRow'));

    expect(rowSource.indexOf('className="checklist-actions"')).toBeGreaterThan(-1);
    expect(rowSource.indexOf('className="checklist-actions"')).toBeLessThan(
      rowSource.indexOf('className="checklist-input"')
    );
  });

  it('handles Tab and Shift+Tab through the checklist key action', () => {
    expect(appSource).toContain("action === 'indent' || action === 'outdent'");
    expect(appSource).toContain('applyChecklistIndent(checklist, itemId)');
    expect(appSource).toContain('applyChecklistOutdent(checklist, itemId)');
  });

  it('clears empty child drafts only while the item still exists', () => {
    expect(appSource).toContain('checklistRef.current.find((candidate) => candidate.id === item.id)');
    expect(appSource).toContain('applyChecklistDelete(checklistRef.current, item.id)');
  });

  it('keeps the hidden entry out of layout and opens it from the row or keyboard focus', () => {
    expect(styles).toMatch(/\.checklist-item\s*{[^}]*position:\s*relative;/s);
    expect(styles).toMatch(/\.checklist-actions\s*{[^}]*position:\s*absolute;/s);
    expect(styles).toMatch(/\.checklist-actions\s*{[^}]*z-index:\s*1;/s);
    expect(styles).toMatch(/\.checklist-actions\s*{[^}]*pointer-events:\s*none;/s);
    expect(styles).toMatch(/\.checklist-parent \.checklist-input\s*{[^}]*padding-right:\s*24px;/s);
    expect(styles).toMatch(/\.checklist-add--subtask\s*{[^}]*pointer-events:\s*none;/s);
    expect(styles).toMatch(/\.checklist-delete\s*{[^}]*pointer-events:\s*none;/s);
    expect(styles).toMatch(/\.checklist-checkbox:checked ~ \.checklist-input/s);
    expect(styles).toMatch(/\.checklist-item:hover \.checklist-add--subtask/s);
    expect(styles).toMatch(/\.checklist-item:focus-within \.checklist-add--subtask/s);
    expect(styles).not.toMatch(/\.checklist-add--subtask\s*{[^}]*max-height:\s*0;/s);
  });

  it('visually separates child groups without sacrificing shrink and wrap behavior', () => {
    expect(styles).toMatch(/\.checklist-children\s*{[^}]*border-left:/s);
    expect(styles).toMatch(/\.checklist-children\s*{[^}]*padding:[^}]*10px;/s);
    expect(styles).toMatch(/\.checklist-item\s*{[^}]*min-width:\s*0;/s);
    expect(styles).toMatch(/\.checklist-input\s*{[^}]*overflow-wrap:\s*anywhere;/s);
  });

  it('emphasizes parents while keeping shortcut guidance out of the task row', () => {
    expect(appSource).toContain('checklist-item--has-children');
    expect(appSource).toContain('getChecklistShortcutHint(checklist, parent.id)');
    expect(appSource).toContain('Shift+Tab 取消子任务层级');
    expect(styles).toMatch(/\.checklist-item--has-children \.checklist-input\s*{[^}]*font-weight:\s*600;/s);
    expect(appSource).not.toContain('>Tab 变子任务<');
    expect(appSource).not.toContain('>Shift+Tab 取消<');
    expect(styles).not.toContain('checklist-shortcut-hint');
    expect(styles).not.toContain('padding-right: 80px');
    expect(styles).not.toContain('padding-right: 96px');
    expect(styles).not.toMatch(/\.checklist-item:focus-within \.checklist-delete/);
  });
});
