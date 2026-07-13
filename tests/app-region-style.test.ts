import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve(__dirname, '../renderer/src/styles.css'), 'utf8');

describe('sticky note app-region CSS contract', () => {
  it('allows dragging from the top drag bar', () => {
    expect(styles).toMatch(/\.drag-bar\s*{[^}]*-webkit-app-region:\s*drag;/s);
  });

  it('keeps toolbar controls and the text input out of the drag region', () => {
    expect(styles).toMatch(/\.toolbar\s*{[^}]*-webkit-app-region:\s*no-drag;/s);
    expect(styles).toMatch(/\.note-name-hit-area\s*{[^}]*-webkit-app-region:\s*no-drag;/s);
    expect(styles).toMatch(/\.note-name-input\s*{[^}]*-webkit-app-region:\s*no-drag;/s);
    expect(styles).toMatch(/\.note-input\s*{[^}]*-webkit-app-region:\s*no-drag;/s);
    expect(styles).not.toMatch(/\.status-label\s*{[^}]*-webkit-app-region:\s*no-drag;/s);
    expect(styles).not.toMatch(/\.note-name-hit-area[^}]*-webkit-app-region:\s*drag;/s);
    expect(styles).toMatch(/\.note-name-hit-area\s*{[^}]*max-width:\s*96px;/s);
    expect(styles).toMatch(/\.drag-grip\s*{[^}]*width:\s*40px;/s);
  });

  it('keeps the visible note shell aligned with the real window bounds', () => {
    expect(styles).toMatch(/\.note-shell\s*{[^}]*width:\s*100vw;/s);
    expect(styles).toMatch(/\.note-shell\s*{[^}]*height:\s*100vh;/s);
    expect(styles).not.toMatch(/\.note-shell\s*{[^}]*margin:\s*20px;/s);
    expect(styles).not.toMatch(/\.note-shell\s*{[^}]*calc\(100vw - 40px\)/s);
    expect(styles).toMatch(/\.note-shell\s*{[^}]*border-radius:\s*8px;/s);
  });

  it('does not draw blue focus outlines around text editing areas', () => {
    expect(styles).toMatch(/\.note-input:focus,\s*\.note-input:focus-visible\s*{[^}]*outline:\s*none;/s);
    expect(styles).toMatch(
      /\.checklist-input:focus,\s*\.checklist-input:focus-visible\s*{[^}]*outline:\s*none;/s
    );
  });
});
