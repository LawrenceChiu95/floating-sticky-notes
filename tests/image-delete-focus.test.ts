import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(resolve(__dirname, '../renderer/src/App.tsx'), 'utf8');

describe('image delete focus restoration contract', () => {
  it('does not use a native confirm dialog for image deletion', () => {
    expect(appSource).not.toContain("window.confirm('删除这张图片？')");
  });

  it('uses in-app image delete confirmation and deferred focus restoration', () => {
    expect(appSource).toContain('pendingImageDelete');
    expect(appSource).toContain('pendingFocusRestoreRef');
    expect(appSource).toContain('focusEditingTarget(focusTarget)');
  });
});
