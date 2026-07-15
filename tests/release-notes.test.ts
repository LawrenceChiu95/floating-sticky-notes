import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// The generator runs in plain Node before electron-vite starts.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  extractReleaseNotes,
  generateReleaseNotesModule,
  getStableReleaseVersion
} = require('../scripts/build-release-notes.cjs') as {
  extractReleaseNotes?: (
    changelog: string,
    packageVersion: string
  ) => {
    sourceVersion: string;
    sections: Array<{ title: string; items: string[] }>;
  };
  generateReleaseNotesModule?: (
    releaseNotes: {
      sourceVersion: string;
      sections: Array<{ title: string; items: string[] }>;
    },
    outputPath: string
  ) => void;
  getStableReleaseVersion?: (version: string) => string;
};

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('release notes build extraction', () => {
  const changelog = `# 变更日志

## [未发布]

### 新增

- 尚未发布的内容

## [0.1.14] - 2026-07-16

### 新增

- 第一项
- 第二项

### 修复

- 第三个变化

## [0.1.13] - 2026-07-15

### 变更

- 旧版本内容
`;

  it('preserves current-version section and item order', () => {
    expect(extractReleaseNotes?.(changelog, '0.1.14')).toEqual({
      sourceVersion: '0.1.14',
      sections: [
        { title: '新增', items: ['第一项', '第二项'] },
        { title: '修复', items: ['第三个变化'] }
      ]
    });
  });

  it('maps prerelease builds to the matching stable core chapter', () => {
    expect(getStableReleaseVersion?.('0.1.14-rc.1')).toBe('0.1.14');
    expect(extractReleaseNotes?.(changelog, '0.1.14-rc.1')).toEqual(
      extractReleaseNotes?.(changelog, '0.1.14')
    );
  });

  it('rejects invalid versions, missing chapters, duplicates, and unsupported content', () => {
    expect(() => getStableReleaseVersion?.('next')).toThrow('Invalid package version');
    expect(() => extractReleaseNotes?.(changelog, '0.1.15')).toThrow(
      'Missing CHANGELOG chapter for 0.1.15'
    );
    expect(() =>
      extractReleaseNotes?.(`${changelog}\n## [0.1.14] - duplicate\n\n### 新增\n\n- 重复`, '0.1.14')
    ).toThrow('Duplicate CHANGELOG chapters for 0.1.14');
    expect(() =>
      extractReleaseNotes?.(
        '## [0.1.14] - 2026-07-16\n\n这里不是受支持的分类或条目',
        '0.1.14'
      )
    ).toThrow('Unsupported CHANGELOG content');
    expect(() =>
      extractReleaseNotes?.(
        '## [0.1.14] - 2026-07-16\n\n### 新增\n\n- 父项\n  - 子项',
        '0.1.14'
      )
    ).toThrow('Unsupported CHANGELOG content');
  });

  it('writes a generated typed module with the extracted payload', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sticky-notes-release-notes-'));
    tempDirectories.push(directory);
    const outputPath = join(directory, 'release-notes.ts');
    const releaseNotes = extractReleaseNotes?.(changelog, '0.1.14');

    generateReleaseNotesModule?.(releaseNotes!, outputPath);

    const generated = await readFile(outputPath, 'utf8');
    expect(generated).toContain("import type { ReleaseNotes } from '../../shared/release-notes';");
    expect(generated).toContain('export const BUILT_RELEASE_NOTES: ReleaseNotes =');
    expect(generated).toContain('"sourceVersion": "0.1.14"');
    expect(generated).toContain('"第三个变化"');
  });

  it('can extract the repository current package version', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(__dirname, '../package.json'), 'utf8')
    ) as { version: string };
    const repositoryChangelog = readFileSync(
      resolve(__dirname, '../CHANGELOG.md'),
      'utf8'
    );

    expect(extractReleaseNotes?.(repositoryChangelog, packageJson.version).sections.length).toBeGreaterThan(0);
  });
});
