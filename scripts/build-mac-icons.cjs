const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (process.platform !== 'darwin') {
  throw new Error('Mac icon generation requires macOS iconutil and sips.');
}

const projectRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(projectRoot, 'assets/icons/app-icon-source.png');
const outputPath = path.join(projectRoot, 'assets/icons/app-icon.icns');
const iconsetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'floating-sticky-notes-iconset-'));
const iconsetDir = path.join(iconsetPath, 'app-icon.iconset');

const entries = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024]
];

function run(command, args) {
  execFileSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit'
  });
}

try {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing source icon: ${sourcePath}`);
  }

  fs.mkdirSync(iconsetDir, { recursive: true });
  for (const [filename, size] of entries) {
    run('sips', ['-z', String(size), String(size), sourcePath, '--out', path.join(iconsetDir, filename)]);
  }

  run('iconutil', ['-c', 'icns', iconsetDir, '-o', outputPath]);
} finally {
  fs.rmSync(iconsetPath, { recursive: true, force: true });
}
