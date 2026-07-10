import { describe, expect, it } from 'vitest';
import {
  ensureAutoLaunchDefaultEnabled,
  getAutoLaunchStatus,
  setAutoLaunchEnabled,
  type AutoLaunchApp,
  type AutoLaunchDefaultState
} from '../main/auto-launch';

describe('auto launch settings', () => {
  it('reads the current login item state without changing it', () => {
    const calls: unknown[] = [];
    const app: AutoLaunchApp = {
      getLoginItemSettings: () => ({ openAtLogin: false }),
      setLoginItemSettings: (settings) => {
        calls.push(settings);
      }
    };
    const status = getAutoLaunchStatus(app);

    expect(status).toEqual({ enabled: false });
    expect(calls).toEqual([]);
  });

  it('enables login item startup only when explicitly requested', () => {
    const calls: unknown[] = [];
    const status = setAutoLaunchEnabled(
      {
        getLoginItemSettings: () => ({ openAtLogin: true }),
        setLoginItemSettings: (settings) => {
          calls.push(settings);
        }
      },
      true
    );

    expect(calls).toEqual([{ openAtLogin: true, openAsHidden: false }]);
    expect(status).toEqual({ enabled: true });
  });

  it('disables login item startup when the user turns the switch off', () => {
    const calls: unknown[] = [];
    const status = setAutoLaunchEnabled(
      {
        getLoginItemSettings: () => ({ openAtLogin: false }),
        setLoginItemSettings: (settings) => {
          calls.push(settings);
        }
      },
      false
    );

    expect(calls).toEqual([{ openAtLogin: false, openAsHidden: false }]);
    expect(status).toEqual({ enabled: false });
  });

  it('enables login item startup the first time the default is applied', () => {
    const calls: unknown[] = [];
    let openAtLogin = false;
    let marked = false;
    const app: AutoLaunchApp = {
      getLoginItemSettings: () => ({ openAtLogin }),
      setLoginItemSettings: (settings) => {
        calls.push(settings);
        openAtLogin = settings.openAtLogin;
      }
    };
    const defaultState: AutoLaunchDefaultState = {
      hasAppliedDefault: () => marked,
      markDefaultApplied: () => {
        marked = true;
      }
    };

    const status = ensureAutoLaunchDefaultEnabled(app, defaultState);

    expect(calls).toEqual([{ openAtLogin: true, openAsHidden: false }]);
    expect(marked).toBe(true);
    expect(status).toEqual({ enabled: true });
  });

  it('does not re-enable startup after the default has already been applied', () => {
    const calls: unknown[] = [];
    const status = ensureAutoLaunchDefaultEnabled(
      {
        getLoginItemSettings: () => ({ openAtLogin: false }),
        setLoginItemSettings: (settings) => {
          calls.push(settings);
        }
      },
      {
        hasAppliedDefault: () => true,
        markDefaultApplied: () => {
          calls.push('marked');
        }
      }
    );

    expect(calls).toEqual([]);
    expect(status).toEqual({ enabled: false });
  });
});
