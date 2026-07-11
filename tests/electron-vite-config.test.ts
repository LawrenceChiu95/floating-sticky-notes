import { describe, expect, it } from 'vitest';
import config from '../electron.vite.config';

type RendererServerConfig = {
  preload?: {
    build?: {
      rollupOptions?: {
        input?: Record<string, string>;
        output?: {
          format?: string;
        };
      };
    };
  };
  renderer?: {
    server?: {
      hmr?: boolean;
    };
    build?: {
      rollupOptions?: {
        input?: Record<string, string>;
      };
    };
  };
};

describe('electron-vite renderer config', () => {
  it('disables renderer HMR so the strict CSP does not block the dev bootstrap', () => {
    const rendererConfig = config as unknown as RendererServerConfig;

    expect(rendererConfig.renderer?.server?.hmr).toBe(false);
  });

  it('builds independent update progress preload and renderer entries', () => {
    const buildConfig = config as unknown as RendererServerConfig;

    expect(buildConfig.preload?.build?.rollupOptions?.input).toHaveProperty(
      'updateProgressPreload'
    );
    expect(buildConfig.renderer?.build?.rollupOptions?.input).toHaveProperty(
      'updateProgress'
    );
    expect(buildConfig.preload?.build?.rollupOptions?.output?.format).toBe('cjs');
  });
});
