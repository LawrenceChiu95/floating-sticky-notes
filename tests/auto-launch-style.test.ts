import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve(__dirname, '../renderer/src/styles.css'), 'utf8');

describe('auto launch switch styling', () => {
  it('does not keep per-note renderer styles for the global startup setting', () => {
    expect(styles).not.toContain('.auto-launch-control');
  });
});
