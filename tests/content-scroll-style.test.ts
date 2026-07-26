import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve(__dirname, '../renderer/src/styles.css'), 'utf8');

describe('sticky note content scrolling', () => {
  it('scrolls the note content area instead of clipping overflowing checklist items', () => {
    expect(styles).toMatch(/\.note-content\s*{[^}]*overflow-y:\s*auto;/s);
    expect(styles).not.toMatch(/\.note-content\s*{[^}]*overflow:\s*hidden;/s);
  });

  it('keeps images in the single content scroll flow instead of creating nested scrolling', () => {
    expect(styles).toMatch(/\.image-list\s*{[^}]*flex:\s*0 0 auto;/s);
    expect(styles).not.toMatch(/\.image-list\s*{[^}]*overflow-y:\s*auto;/s);
    expect(styles).not.toMatch(/\.image-list\s*{[^}]*max-height:\s*58%;/s);
    // 图片上限跟随窗口高度:默认 220px 便签里方图/竖图不会把 textarea 顶出可视区,
    // 大窗口下仍维持 240px(见 #10 QA 验收 item6)。
    expect(styles).toMatch(/\.note-image\s*{[^}]*max-height:\s*min\(240px,\s*45vh\);/s);
  });

  it('keeps the checklist at natural height inside the content scroll area', () => {
    expect(styles).toMatch(/\.note-content\s*{[^}]*min-height:\s*0;/s);
    expect(styles).toMatch(/\.checklist\s*{[^}]*flex:\s*0 0 auto;/s);
  });

  it('uses a quiet thin scrollbar only for overflowing content', () => {
    expect(styles).toMatch(/\.note-content::-webkit-scrollbar\s*{[^}]*width:\s*8px;/s);
    expect(styles).toMatch(/\.note-content::-webkit-scrollbar-track\s*{[^}]*background:\s*transparent;/s);
    expect(styles).toMatch(/\.note-content::-webkit-scrollbar-thumb\s*{[^}]*rgba\(43,\s*42,\s*39,\s*0\.28\)/s);
  });
});
