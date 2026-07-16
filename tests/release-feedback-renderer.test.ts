import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createReleaseFeedbackView,
  isReleaseFeedbackSnapshot
} from '../renderer/src/release-feedback';

const html = readFileSync(resolve(__dirname, '../renderer/release-feedback.html'), 'utf8');
const source = readFileSync(resolve(__dirname, '../renderer/src/release-feedback.ts'), 'utf8');
const styles = readFileSync(resolve(__dirname, '../renderer/src/release-feedback.css'), 'utf8');

describe('release feedback renderer', () => {
  it('creates automatic and manual copy without dropping version groups', () => {
    const releases = [
      {
        version: '0.1.14',
        date: '2026-07-16',
        sections: [{ title: '新增', items: ['子任务', '完整换行'] }]
      },
      {
        version: '0.1.15',
        date: '2026-07-17',
        sections: [{ title: '修复', items: ['窗口'] }]
      }
    ];

    expect(
      createReleaseFeedbackView({ initiatedBy: 'automatic', version: '0.1.15', releases })
    ).toEqual({
      eyebrow: '版本更新',
      versionLabel: 'v0.1.15',
      summary: '悬浮便签已更新，以下是本次变化。',
      metadata: '2 个版本 · 3 项',
      status: '已更新完成',
      releases,
      singleRelease: false,
      emptyMessage: undefined
    });
    expect(
      createReleaseFeedbackView({ initiatedBy: 'manual', version: '0.1.15', releases: [] })
    ).toEqual({
      eyebrow: '当前版本',
      versionLabel: 'v0.1.15',
      summary: '以下是当前版本的新增与修复。',
      metadata: '0 项',
      status: '当前已安装',
      releases: [],
      singleRelease: false,
      emptyMessage: '本版本暂无更新说明'
    });
  });

  it('formats a single release with its CHANGELOG date and item count', () => {
    const release = {
      version: '0.1.14',
      date: '2026-07-16',
      sections: [
        { title: '新增', items: ['子任务'] },
        { title: '修复', items: ['完整换行', '输入法确认'] }
      ]
    };

    expect(
      createReleaseFeedbackView({
        initiatedBy: 'manual',
        version: '0.1.14',
        releases: [release]
      })
    ).toMatchObject({
      metadata: '2026.07.16 · 3 项',
      releases: [release],
      singleRelease: true
    });
  });

  it.each([
    undefined,
    null,
    {},
    { initiatedBy: 'other', version: '0.1.15', releases: [] },
    { initiatedBy: 'manual', version: '', releases: [] },
    { initiatedBy: 'manual', version: '0.1.15', releases: [{}] },
    {
      initiatedBy: 'manual',
      version: '0.1.15',
      releases: [
        {
          version: '0.1.15',
          date: '2026-02-30',
          sections: [{ title: '新增', items: ['窗口'] }]
        }
      ]
    },
    {
      initiatedBy: 'manual',
      version: '0.1.15',
      releases: [
        {
          version: '0.1.15',
          date: '2026-07-17',
          sections: [{ title: '新增', items: [42] }]
        }
      ]
    }
  ])('rejects invalid snapshots %#', (value) => {
    expect(isReleaseFeedbackSnapshot(value)).toBe(false);
  });

  it('uses an editorial masthead, semantic grouped lists, fixed actions and internal scrolling', () => {
    expect(html).toContain('<html lang="zh-CN">');
    expect(html).toMatch(/<main[^>]+tabindex="-1"/);
    expect(html).toContain('<p id="release-feedback-eyebrow"');
    expect(html).toContain('<p id="release-feedback-metadata"');
    expect(html).toContain('<h1 id="release-feedback-version"');
    expect(html).toContain('<p id="release-feedback-summary"');
    expect(html).toContain('<span id="release-feedback-status-label"');
    expect(html).toContain('<button id="release-feedback-dismiss"');
    expect(source).toContain("document.createElement('h2')");
    expect(source).toContain("document.createElement('time')");
    expect(source).toContain("document.createElement('h3')");
    expect(source).toContain("document.createElement('ul')");
    expect(source).toContain("document.createElement('li')");
    expect(source).toContain("release-feedback__release--single");
    expect(source).toContain("event.key === 'Escape'");
    expect(styles).toMatch(/\.release-feedback__releases\s*{[^}]*overflow-y:\s*auto;/s);
    expect(styles).toMatch(/\.release-feedback--bounded\s*{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto;/s);
    expect(styles).toMatch(/\.release-feedback__section\s*{[^}]*grid-template-columns:/s);
    expect(styles).toMatch(
      /\.release-feedback__section ul\s*{[^}]*list-style:\s*disc;/s
    );
    expect(styles).toMatch(
      /\.release-feedback__section li::marker\s*{[^}]*color:\s*var\(--update-window-accent\);/s
    );
    expect(styles).toContain('scrollbar-gutter: stable;');
    expect(styles).toMatch(/\.release-feedback:focus\s*{[^}]*outline:\s*none;/s);
    expect(styles).toContain(':focus-visible');
    expect(styles).toContain('color: var(--update-window-text);');
    expect(styles).toContain('background: var(--update-window-accent);');
    expect(styles).toMatch(/\.release-feedback__footer button\s*{[^}]*font-size:\s*13px;/s);
  });
});
