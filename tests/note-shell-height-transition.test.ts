import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve(__dirname, '../renderer/src/styles.css'), 'utf8');

// 用户手动缩放窗口时,纸面必须逐帧贴住 100vh;高度动画只允许出现在收起/展开
// 过渡态。基础态挂 height 过渡曾导致:顶边上拉时窗口底边锚定、纸面却用 240ms
// 追赶窗口,底部先缩一下再弹回。
describe('note shell height transition scoping', () => {
  it('keeps the base shell free of height animation so manual resizes track the window', () => {
    expect(styles).not.toMatch(/\.note-shell\s*{[^}]*transition:[^;}]*height/s);
    expect(styles).not.toMatch(/\.note-shell\s*{[^}]*will-change:\s*height/s);
  });

  it('scopes the height transition to the collapse transition state', () => {
    expect(styles).toMatch(
      /\.note-shell--collapse-transitioning\s*{[^}]*transition:\s*height 240ms/s
    );
    expect(styles).toMatch(
      /\.note-shell--collapse-transitioning\s*{[^}]*will-change:\s*height/s
    );
  });

  it('keeps the border-radius transition available in the base shell', () => {
    expect(styles).toMatch(/\.note-shell\s*{[^}]*transition:\s*border-radius 200ms ease;/s);
  });
});
