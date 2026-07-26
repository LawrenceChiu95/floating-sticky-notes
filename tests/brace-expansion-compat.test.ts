import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

const minimatchModuleIds = [
  '@electron/asar/node_modules/minimatch',
  '@electron/universal/node_modules/minimatch',
  'filelist/node_modules/minimatch',
  'minimatch'
] as const;

type MinimatchModule =
  | ((path: string, pattern: string) => boolean)
  | { minimatch: (path: string, pattern: string) => boolean };

function getMinimatch(moduleId: (typeof minimatchModuleIds)[number]) {
  const loaded = require(moduleId) as MinimatchModule;

  return typeof loaded === 'function' ? loaded : loaded.minimatch;
}

describe('brace-expansion compatibility override', () => {
  it.each(minimatchModuleIds)('%s keeps brace patterns working', (moduleId) => {
    const minimatch = getMinimatch(moduleId);

    expect(minimatch('images/icon.png', 'images/*.{png,jpg}')).toBe(true);
    expect(minimatch('images/icon.gif', 'images/*.{png,jpg}')).toBe(false);
  });

  it('retains the patched total expansion length bound', () => {
    const legacyMinimatch = require(
      '@electron/asar/node_modules/minimatch'
    ) as typeof import('minimatch');
    const expansions = legacyMinimatch.braceExpand('{a,b}'.repeat(1_500));
    const totalLength = expansions.reduce((sum, value) => sum + value.length, 0);

    expect(expansions.length).toBeGreaterThan(0);
    expect(totalLength).toBeLessThanOrEqual(4_000_000);
  });
});
