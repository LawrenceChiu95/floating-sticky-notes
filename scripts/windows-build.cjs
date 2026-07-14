const { execFileSync } = require('node:child_process');
const path = require('node:path');

const updateOwner = 'LawrenceChiu95';
const updateRepository = 'floating-sticky-notes-updates';

function buildWindows({ output, artifactName, channel, extraResources = [] }) {
  const projectRoot = path.resolve(__dirname, '..');
  const npmInvocation = getNpmInvocation(process.platform, process.execPath);
  const electronBuilderInvocation = getElectronBuilderInvocation(
    process.platform,
    projectRoot,
    process.execPath
  );

  run(npmInvocation.command, [...npmInvocation.argsPrefix, 'run', 'build:icons'], projectRoot);
  run(npmInvocation.command, [...npmInvocation.argsPrefix, 'run', 'build'], projectRoot);
  run(
    electronBuilderInvocation.command,
    [
      ...electronBuilderInvocation.argsPrefix,
      '--win',
      '--x64',
      `--config.directories.output=${output}`,
      `--config.nsis.artifactName=${artifactName}`,
      '--config.publish.provider=github',
      `--config.publish.owner=${updateOwner}`,
      `--config.publish.repo=${updateRepository}`,
      `--config.publish.channel=${channel}`,
      ...extraResources.map((resource) => `--config.extraResources=${resource}`),
      '--publish',
      'never'
    ],
    projectRoot
  );
}

function getElectronBuilderInvocation(platform, projectRoot, nodeExecutable) {
  if (platform === 'win32') {
    return {
      command: nodeExecutable,
      argsPrefix: [path.win32.join(projectRoot, 'node_modules', 'electron-builder', 'cli.js')]
    };
  }

  return {
    command: path.join(projectRoot, 'node_modules', '.bin', 'electron-builder'),
    argsPrefix: []
  };
}

function getPublishChannel(version) {
  const prereleaseChannel = /^\d+\.\d+\.\d+-([0-9A-Za-z-]+)/.exec(version)?.[1];
  return prereleaseChannel || 'latest';
}

function getNpmInvocation(platform, nodeExecutable) {
  if (platform === 'win32') {
    return {
      command: nodeExecutable,
      argsPrefix: [
        path.win32.join(
          path.win32.dirname(nodeExecutable),
          'node_modules',
          'npm',
          'bin',
          'npm-cli.js'
        )
      ]
    };
  }

  return { command: 'npm', argsPrefix: [] };
}

function run(command, args, cwd) {
  execFileSync(command, args, {
    cwd,
    env: process.env,
    stdio: 'inherit'
  });
}

module.exports = {
  buildWindows,
  getElectronBuilderInvocation,
  getNpmInvocation,
  getPublishChannel
};
