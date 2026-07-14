import { describe, expect, it } from 'vitest';

// The Windows build runs from Node, where spawning npm.cmd directly fails with
// EINVAL on Node 22. Exercise the invocation choice without starting a build.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  getNpmInvocation,
  getElectronBuilderInvocation,
  getPublishChannel
} = require('../scripts/windows-build.cjs') as {
  getNpmInvocation?: (platform: NodeJS.Platform, nodeExecutable: string) => {
    command: string;
    argsPrefix: string[];
  };
  getElectronBuilderInvocation?: (platform: NodeJS.Platform, projectRoot: string, nodeExecutable: string) => {
    command: string;
    argsPrefix: string[];
  };
  getPublishChannel?: (version: string) => string;
};

describe('Windows build command', () => {
  it('runs npm through node instead of spawning npm.cmd', () => {
    expect(getNpmInvocation).toBeTypeOf('function');
    expect(getNpmInvocation?.('win32', 'C:\\Program Files\\nodejs\\node.exe')).toEqual({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      argsPrefix: ['C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js']
    });
  });

  it('runs electron-builder through node instead of spawning its cmd shim', () => {
    expect(getElectronBuilderInvocation).toBeTypeOf('function');
    expect(
      getElectronBuilderInvocation?.(
        'win32',
        'C:\\project',
        'C:\\Program Files\\nodejs\\node.exe'
      )
    ).toEqual({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      argsPrefix: ['C:\\project\\node_modules\\electron-builder\\cli.js']
    });
  });

  it('derives the update channel from the package version', () => {
    expect(getPublishChannel).toBeTypeOf('function');
    expect(getPublishChannel?.('0.1.13-rc.1')).toBe('rc');
    expect(getPublishChannel?.('0.1.13-beta.2')).toBe('beta');
    expect(getPublishChannel?.('0.1.13')).toBe('latest');
  });
});
