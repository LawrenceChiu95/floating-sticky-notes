const { execFileSync } = require('node:child_process');
const path = require('node:path');

if (process.platform !== 'darwin') {
  throw new Error('Mac packaging requires macOS.');
}

const projectRoot = path.resolve(__dirname, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const electronBuilder = path.join(projectRoot, 'node_modules', '.bin', 'electron-builder');
const appPath = path.join(projectRoot, 'release-mac', 'mac-arm64', '悬浮便签.app');
const updateUrl =
  'https://github.com/LawrenceChiu95/floating-sticky-notes-updates/releases/latest/download';

function run(command, args) {
  execFileSync(command, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit'
  });
}

run(npmCommand, ['run', 'build']);
run(electronBuilder, [
  '--mac',
  '--arm64',
  '--config.directories.output=release-mac',
  '--config.dmg.artifactName=StickyNotes-Mac-${version}.${ext}',
  '--config.publish.provider=generic',
  `--config.publish.url=${updateUrl}`,
  '--config.publish.channel=latest',
  '--publish',
  'never'
]);
run('codesign', [
  '--verify', '--deep', '--strict', '--verbose=2',
  appPath
]);
