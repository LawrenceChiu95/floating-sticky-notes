// 编译 macOS 鼠标按键状态监视器（native/mouse-state.c → bin/mouse-state-darwin-arm64）。
// 产物提交进仓库，正常开发不需要重跑；改了 .c 源才需要。仅限 macOS。
const { execFileSync } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');

if (process.platform !== 'darwin') {
  console.log('mouse-state helper is darwin-only, skipping');
  process.exit(0);
}

const root = join(__dirname, '..');
mkdirSync(join(root, 'bin'), { recursive: true });
execFileSync(
  'cc',
  [
    '-O2',
    '-o',
    join(root, 'bin', 'mouse-state-darwin-arm64'),
    join(root, 'native', 'mouse-state.c'),
    '-framework',
    'CoreGraphics',
    '-framework',
    'CoreFoundation'
  ],
  { stdio: 'inherit' }
);
console.log('built bin/mouse-state-darwin-arm64');
