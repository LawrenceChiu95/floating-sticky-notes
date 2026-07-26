import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve(__dirname, '../renderer/src/styles.css'), 'utf8');

function getCssBlock(source: string, selector: string): string {
  const selectorIndex = source.indexOf(selector);
  const openingBraceIndex = source.indexOf('{', selectorIndex);

  if (selectorIndex === -1 || openingBraceIndex === -1) {
    return '';
  }

  let depth = 0;

  for (let index = openingBraceIndex; index < source.length; index += 1) {
    if (source[index] === '{') {
      depth += 1;
    } else if (source[index] === '}') {
      depth -= 1;

      if (depth === 0) {
        return source.slice(openingBraceIndex + 1, index);
      }
    }
  }

  return '';
}

describe('sticky note app-region CSS contract', () => {
  it('allows dragging from the top drag bar', () => {
    expect(styles).toMatch(/\.drag-bar\s*{[^}]*-webkit-app-region:\s*drag;/s);
  });

  it('keeps toolbar controls and the text input out of the drag region', () => {
    expect(styles).toMatch(/\.toolbar\s*{[^}]*-webkit-app-region:\s*no-drag;/s);
    expect(styles).toMatch(/\.drag-bar-actions\s*{[^}]*-webkit-app-region:\s*no-drag;/s);
    expect(styles).toMatch(/\.note-name-hit-area\s*{[^}]*-webkit-app-region:\s*no-drag;/s);
    expect(styles).toMatch(/\.note-name-input\s*{[^}]*-webkit-app-region:\s*no-drag;/s);
    expect(styles).toMatch(/\.note-input\s*{[^}]*-webkit-app-region:\s*no-drag;/s);
    expect(styles).not.toMatch(/\.status-label\s*{[^}]*-webkit-app-region:\s*no-drag;/s);
    expect(styles).not.toMatch(/\.note-name-hit-area[^}]*-webkit-app-region:\s*drag;/s);
    expect(styles).toMatch(
      /\.note-name-hit-area\s*{[^}]*max-width:\s*var\(--note-name-max-width\);/s
    );
    expect(styles).toMatch(/\.drag-grip\s*{[^}]*width:\s*28px;/s);
    expect(styles).toMatch(/\.collapsed-title\s*{[^}]*pointer-events:\s*none;/s);
  });

  it('keeps all toolbar controls inside the minimum-width window', () => {
    const narrowWindowStyles = getCssBlock(styles, '@media (max-width: 220px)');

    expect(narrowWindowStyles).toMatch(/\.toolbar\s*{[^}]*gap:\s*0;/s);
    expect(narrowWindowStyles).toMatch(/\.toolbar button\s*{[^}]*width:\s*20px;/s);
    expect(narrowWindowStyles).toMatch(/\.drag-grip\s*{[^}]*width:\s*22px;/s);
    expect(narrowWindowStyles).toMatch(/\.collapse-toggle\s*{[^}]*width:\s*22px;/s);
  });

  it('keeps the drag grip line at its original absolute position', () => {
    const readPx = (ruleBody: string, property: string): number => {
      const match = ruleBody.match(new RegExp(`${property}:\\s*(\\d+(?:\\.\\d+)?)px`));
      if (!match) {
        throw new Error(`Missing ${property}`);
      }
      return Number(match[1]);
    };
    const readTranslateX = (ruleBody: string): number => {
      const match = ruleBody.match(/transform:\s*translateX\((\d+(?:\.\d+)?)px\)/);
      return match ? Number(match[1]) : 0;
    };
    const lineLeftEdge = (
      barPaddingLeft: number,
      gripWidth: number,
      lineWidth: number,
      translateX: number
    ): number => barPaddingLeft + (gripWidth - lineWidth) / 2 + translateX;

    const mustMatch = (source: string, pattern: RegExp): string => {
      const match = source.match(pattern);
      if (!match) {
        throw new Error(`Missing pattern: ${pattern}`);
      }
      return match[1];
    };
    const gripBody = getCssBlock(styles, '.drag-grip {');
    const gripLineBody = getCssBlock(styles, '.drag-grip::after');
    const barBody = getCssBlock(styles, '.drag-bar {');
    const barPaddingLeft = Number(
      mustMatch(barBody, /padding:\s*\d+px\s+\d+px\s+\d+px\s+(\d+)px;/)
    );

    expect(
      lineLeftEdge(
        barPaddingLeft,
        readPx(gripBody, 'width'),
        readPx(gripLineBody, 'width'),
        readTranslateX(gripLineBody)
      )
    ).toBe(16);

    const narrowWindowStyles = getCssBlock(styles, '@media (max-width: 220px)');
    const narrowBarPadding = Number(
      mustMatch(narrowWindowStyles, /\.drag-bar\s*{[^}]*padding-left:\s*(\d+)px;/s)
    );
    const narrowGripWidth = Number(
      mustMatch(narrowWindowStyles, /\.drag-grip\s*{[^}]*width:\s*(\d+)px;/s)
    );
    const narrowLineBody = mustMatch(narrowWindowStyles, /\.drag-grip::after\s*{([^}]*)}/s);

    expect(
      lineLeftEdge(
        narrowBarPadding,
        narrowGripWidth,
        readPx(narrowLineBody, 'width'),
        readTranslateX(narrowLineBody)
      )
    ).toBe(10);
  });

  it('centers the collapsed name in the window despite asymmetric chrome', () => {
    const mustMatch = (source: string, pattern: RegExp): string => {
      const match = source.match(pattern);
      if (!match) {
        throw new Error(`Missing pattern: ${pattern}`);
      }
      return match[1];
    };
    const windowWidth = 280;
    const borderWidth = 1;
    const collapsedBarBody = getCssBlock(styles, '.note-shell--collapsed .drag-bar');
    const barPaddingLeft = Number(
      mustMatch(collapsedBarBody, /padding:\s*\d+px\s+\d+px\s+\d+px\s+(\d+)px;/)
    );
    const barPaddingRight = Number(
      mustMatch(collapsedBarBody, /padding:\s*\d+px\s+(\d+)px\s+\d+px\s+\d+px;/)
    );
    const gripWidth = Number(mustMatch(getCssBlock(styles, '.drag-grip {'), /width:\s*(\d+)px;/));
    const toggleWidth = Number(
      mustMatch(getCssBlock(styles, '.collapse-toggle {'), /width:\s*(\d+)px;/)
    );
    const titlePaddingRight = Number(
      mustMatch(getCssBlock(styles, '.collapsed-title {'), /padding:\s*0\s+(\d+)px\s+0\s+0;/)
    );
    const titleContentLeft = borderWidth + barPaddingLeft + gripWidth;
    const titleContentRight =
      windowWidth - borderWidth - barPaddingRight - toggleWidth - titlePaddingRight;

    expect((titleContentLeft + titleContentRight) / 2).toBe(windowWidth / 2);

    const narrowWindowStyles = getCssBlock(styles, '@media (max-width: 220px)');
    const narrowWindowWidth = 200;
    const narrowGripWidth = Number(
      mustMatch(narrowWindowStyles, /\.drag-grip\s*{[^}]*width:\s*(\d+)px;/s)
    );
    const narrowToggleWidth = Number(
      mustMatch(narrowWindowStyles, /\.collapse-toggle\s*{[^}]*width:\s*(\d+)px;/s)
    );
    const narrowTitlePaddingRight = Number(
      mustMatch(narrowWindowStyles, /\.collapsed-title\s*{[^}]*padding-right:\s*(\d+)px;/s)
    );
    const narrowTitleContentLeft = borderWidth + barPaddingLeft + narrowGripWidth;
    const narrowTitleContentRight =
      narrowWindowWidth -
      borderWidth -
      barPaddingRight -
      narrowToggleWidth -
      narrowTitlePaddingRight;

    expect((narrowTitleContentLeft + narrowTitleContentRight) / 2).toBe(
      narrowWindowWidth / 2
    );
  });

  it('centers both name editors without letting the toolbar move the display name during a fold', () => {
    const statusLabel = getCssBlock(styles, '.status-label {');
    const transitionLabel = getCssBlock(
      styles,
      '.note-shell--collapse-transitioning .status-label'
    );
    const collapsedTitle = getCssBlock(styles, '.collapsed-title {');

    expect(statusLabel).toMatch(/padding:\s*0;/);
    expect(statusLabel).toMatch(/text-align:\s*center;/);
    expect(transitionLabel).toMatch(/justify-self:\s*start;/);
    expect(transitionLabel).toMatch(/width:\s*var\(--note-transition-title-width\);/);
    expect(collapsedTitle).toMatch(/justify-content:\s*center;/);
    expect(styles).toMatch(
      /(?:^|\n)\.note-name-input\s*{[^}]*text-align:\s*center;/s
    );
    expect(styles).not.toMatch(
      /\.collapsed-title \.note-name-input\s*{[^}]*text-align:/s
    );
  });

  it('keeps the note-delete confirmation inside the window at any width', () => {
    expect(styles).toMatch(
      /\.note-delete-confirm\s*{[^}]*max-width:\s*calc\(100vw - 18px\);/s
    );
    const midWindowStyles = getCssBlock(styles, '@media (max-width: 250px)');
    expect(midWindowStyles).toMatch(/\.note-delete-confirm\s*{[^}]*right:\s*9px;/s);
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
