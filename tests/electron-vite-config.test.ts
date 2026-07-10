import { describe, expect, it } from 'vitest';
import config from '../electron.vite.config';

type RendererServerConfig = {
  renderer?: {
    server?: {
      hmr?: boolean;
    };
  };
};

describe('electron-vite renderer config', () => {
  it('disables renderer HMR so the strict CSP does not block the dev bootstrap', () => {
    const rendererConfig = config as unknown as RendererServerConfig;

    expect(rendererConfig.renderer?.server?.hmr).toBe(false);
  });
});
