import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// The generator runs in plain Node before electron-vite starts.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  extractReleaseNotesArchive,
  generateReleaseNotesModule,
  getStableReleaseVersion
} = require('../scripts/build-release-notes.cjs') as {
  extractReleaseNotesArchive?: (
    changelog: string,
    packageVersion: string
  ) => {
    releases: Array<{
      version: string;
      date: string;
      sections: Array<{ title: string; items: string[] }>;
    }>;
  };
  generateReleaseNotesModule?: (
    releaseNotes: {
      releases: Array<{
        version: string;
        date: string;
        sections: Array<{ title: string; items: string[] }>;
      }>;
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

  it('preserves every stable chapter in SemVer order', () => {
    expect(extractReleaseNotesArchive?.(changelog, '0.1.14')).toEqual({
      releases: [
        {
          version: '0.1.13',
          date: '2026-07-15',
          sections: [{ title: '变更', items: ['旧版本内容'] }]
        },
        {
          version: '0.1.14',
          date: '2026-07-16',
          sections: [
            { title: '新增', items: ['第一项', '第二项'] },
            { title: '修复', items: ['第三个变化'] }
          ]
        }
      ]
    });
  });

  it('maps prerelease builds to the stable core without archiving a prerelease chapter', () => {
    expect(getStableReleaseVersion?.('0.1.14-rc.1')).toBe('0.1.14');
    expect(extractReleaseNotesArchive?.(changelog, '0.1.14-rc.1')).toEqual(
      extractReleaseNotesArchive?.(changelog, '0.1.14')
    );
  });

  it('rejects invalid versions, missing current chapters, duplicate stable chapters, and invalid chapter bodies', () => {
    expect(() => getStableReleaseVersion?.('next')).toThrow('Invalid package version');
    expect(() => extractReleaseNotesArchive?.(changelog, '0.1.15')).toThrow(
      'Missing CHANGELOG chapter for 0.1.15'
    );
    expect(() =>
      extractReleaseNotesArchive?.(
        `${changelog}\n## [0.1.14] - duplicate\n\n### 新增\n\n- 重复`,
        '0.1.14'
      )
    ).toThrow('Duplicate CHANGELOG chapters for 0.1.14');
    expect(() =>
      extractReleaseNotesArchive?.(
        '## [0.1.13] - 2026-07-15\n\n### 新增\n\n- 正常\n\n## [0.1.14] - 2026-07-16\n\n这里不受支持',
        '0.1.14'
      )
    ).toThrow('Unsupported CHANGELOG content in 0.1.14');
    expect(() =>
      extractReleaseNotesArchive?.(
        '## [0.1.13] - 2026-07-15\n\n### 新增\n\n- 正常\n\n## [0.1.14] - 2026-07-16\n\n### 新增',
        '0.1.14'
      )
    ).toThrow('Empty CHANGELOG category in 0.1.14');
    expect(() =>
      extractReleaseNotesArchive?.(
        '## [0.1.13] - 2026-07-15\n\n### 新增\n\n- 正常\n\n## [0.1.14] - 2026-07-16\n\n### 新增\n\n- 父项\n  - 子项',
        '0.1.14'
      )
    ).toThrow('Unsupported CHANGELOG content in 0.1.14');
  });

  it.each([
    ['missing', '## [0.1.14]'],
    ['malformed', '## [0.1.14] - July 16, 2026'],
    ['impossible', '## [0.1.14] - 2026-02-30']
  ])('rejects %s stable release dates', (_label, heading) => {
    expect(() =>
      extractReleaseNotesArchive?.(
        `${heading}\n\n### 新增\n\n- 正常`,
        '0.1.14'
      )
    ).toThrow('Invalid CHANGELOG date for 0.1.14');
  });

  it('writes a generated typed module containing the full archive', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sticky-notes-release-notes-'));
    tempDirectories.push(directory);
    const outputPath = join(directory, 'release-notes.ts');
    const releaseNotes = extractReleaseNotesArchive?.(changelog, '0.1.14');

    generateReleaseNotesModule?.(releaseNotes!, outputPath);

    const generated = await readFile(outputPath, 'utf8');
    expect(generated).toContain(
      "import type { ReleaseNotesArchive } from '../../shared/release-notes';"
    );
    expect(generated).toContain(
      'export const BUILT_RELEASE_NOTES: ReleaseNotesArchive ='
    );
    expect(generated).toContain('"version": "0.1.13"');
    expect(generated).toContain('"date": "2026-07-15"');
    expect(generated).toContain('"version": "0.1.14"');
    expect(generated).toContain('"date": "2026-07-16"');
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

    const archive = extractReleaseNotesArchive?.(repositoryChangelog, packageJson.version);
    expect(archive?.releases.at(-1)?.version).toBe(packageJson.version);
    expect(archive?.releases.length).toBeGreaterThan(1);

    const release014 = archive?.releases.find((release) => release.version === '0.1.14');
    expect(release014?.sections.find((section) => section.title === '新增')?.items).toEqual([
      '待办清单支持一层可选子任务，可用 Tab / Shift+Tab 调整层级，并提供父任务行上的轻量鼠标入口。',
      '托盘现在会显示当前版本，点击即可随时查看本版新增与修复。'
    ]);
    expect(release014?.sections.find((section) => section.title === '修复')?.items).toEqual([
      '待办事项现在会根据便签宽度完整换行并自动调整高度，长网址和连续字符不再被截断。',
      '中文输入法确认候选词时不再误创建下一条待办。'
    ]);
    expect(release014?.sections.some((section) => section.title === '变更')).toBe(false);

    const release015 = archive?.releases.find((release) => release.version === '0.1.15');
    expect(release015?.sections).toEqual([
      {
        title: '变更',
        items: [
          '版本更新反馈改用紧凑、非模态的自有窗口。',
          '少量内容时，窗口会根据内容自然收紧。',
          '跳版本或内容较长时，更新内容可在固定页头和操作区之间滚动查看。',
          '收小“知道了”按钮的文字字号。'
        ]
      }
    ]);
  });
});
