import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(resolve(__dirname, '../renderer/src/App.tsx'), 'utf8');
const styles = readFileSync(resolve(__dirname, '../renderer/src/styles.css'), 'utf8');

describe('checklist text wrapping', () => {
  it('uses a textarea while preserving Enter-based checklist editing', () => {
    expect(appSource).toMatch(/<textarea\s+className="checklist-input"\s+rows=\{1\}/s);
    expect(appSource).not.toMatch(/<input\s+className="checklist-input"/s);
    expect(appSource).toMatch(
      /getChecklistKeyAction\(\s*event\.key,\s*event\.nativeEvent\.isComposing,\s*event\.shiftKey\s*\)/s
    );
    expect(appSource).toContain('normalizeChecklistText(event.target.value)');
    expect(appSource).toContain("action === 'enter'");
  });

  it('grows each checklist field with wrapped content without an inner scrollbar', () => {
    expect(styles).toMatch(/\.checklist-input\s*{[^}]*field-sizing:\s*content;/s);
    expect(styles).toMatch(/\.checklist-input\s*{[^}]*overflow:\s*hidden;/s);
    expect(styles).toMatch(/\.checklist-input\s*{[^}]*resize:\s*none;/s);
    expect(styles).toMatch(/\.checklist-input\s*{[^}]*max-height:\s*none;/s);
  });

  it('wraps unbroken URLs, identifiers, and numbers instead of overflowing horizontally', () => {
    expect(styles).toMatch(/\.checklist-input\s*{[^}]*overflow-wrap:\s*anywhere;/s);
    expect(styles).toMatch(/\.checklist-input\s*{[^}]*word-break:\s*normal;/s);
    expect(styles).toMatch(/\.note-content\s*{[^}]*overflow-x:\s*hidden;/s);
  });

  it('aligns the checkbox and delete button with the first text line', () => {
    expect(styles).toMatch(/\.checklist-item\s*{[^}]*align-items:\s*start;/s);
    expect(styles).toMatch(/\.checklist-checkbox\s*{[^}]*margin:\s*4px 0 0;/s);
    expect(styles).toMatch(/\.checklist-delete\s*{[^}]*margin-top:\s*1px;/s);
  });
});
