const { execFileSync } = require('node:child_process');
const path = require('node:path');

const updateFeedUrl =
  'https://github.com/LawrenceChiu95/floating-sticky-notes-updates/releases/latest/download';

function buildWindows({ output, artifactName, channel, extraResources = [] }) {
  const projectRoot = path.resolve(__dirname, '..');
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const electronBuilder = path.join(
    projectRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder'
  );

  run(npmCommand, ['run', 'build:icons'], projectRoot);
  run(npmCommand, ['run', 'build'], projectRoot);
  run(
    electronBuilder,
    [
      '--win',
      '--x64',
      `--config.directories.output=${output}`,
      `--config.nsis.artifactName=${artifactName}`,
      '--config.publish.provider=generic',
      `--config.publish.url=${updateFeedUrl}`,
      `--config.publish.channel=${channel}`,
      ...extraResources.map((resource) => `--config.extraResources=${resource}`),
      '--publish',
      'never'
    ],
    projectRoot
  );
}

function run(command, args, cwd) {
  execFileSync(command, args, {
    cwd,
    env: process.env,
    stdio: 'inherit'
  });
}

module.exports = { buildWindows };
