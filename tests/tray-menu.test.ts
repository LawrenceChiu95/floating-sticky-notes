import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildTrayMenuTemplate, TRAY_TOOLTIP, type TrayMenuDeps } from '../main/tray-menu';
import {
  getAutoLaunchStatus,
  setAutoLaunchEnabled,
  type AutoLaunchApp
} from '../main/auto-launch';

type TrayMenuItem = ReturnType<typeof buildTrayMenuTemplate>[number];

function createDeps(overrides: Partial<TrayMenuDeps> = {}): TrayMenuDeps {
  return {
    getAutoLaunchEnabled: () => false,
    setAutoLaunchEnabled: () => undefined,
    createNote: () => undefined,
    restoreNotes: () => undefined,
    checkForUpdates: () => undefined,
    currentVersion: '0.1.14',
    showCurrentRelease: () => undefined,
    quit: () => undefined,
    ...overrides
  } as TrayMenuDeps;
}

function findItem(template: TrayMenuItem[], label: string): TrayMenuItem | undefined {
  return template.find((item) => item.label === label);
}

describe('tray menu template', () => {
  it('contains note recovery, update, current version, startup, and exit actions', () => {
    const template = buildTrayMenuTemplate(createDeps());
    const labels = template.map((item) => item.label);

    expect(labels).toContain('新建便签');
    expect(labels).toContain('显示所有便签');
    expect(labels).toContain('检查更新');
    expect(labels).toContain('开机时启动');
    expect(labels).toContain('版本 0.1.14');
    expect(labels).toContain('退出');
    expect(findItem(template, '开机时启动')?.type).toBe('checkbox');
  });

  it('reflects getAutoLaunchStatus in the 开机时启动 checked state', () => {
    const enabledApp: Pick<AutoLaunchApp, 'getLoginItemSettings'> = {
      getLoginItemSettings: () => ({ openAtLogin: true })
    };
    const disabledApp: Pick<AutoLaunchApp, 'getLoginItemSettings'> = {
      getLoginItemSettings: () => ({ openAtLogin: false })
    };

    const checkedTemplate = buildTrayMenuTemplate(
      createDeps({ getAutoLaunchEnabled: () => getAutoLaunchStatus(enabledApp).enabled })
    );
    const uncheckedTemplate = buildTrayMenuTemplate(
      createDeps({ getAutoLaunchEnabled: () => getAutoLaunchStatus(disabledApp).enabled })
    );

    expect(findItem(checkedTemplate, '开机时启动')?.checked).toBe(true);
    expect(findItem(uncheckedTemplate, '开机时启动')?.checked).toBe(false);
  });

  it('toggling 开机时启动 calls setAutoLaunchEnabled with the next value', () => {
    const calls: unknown[] = [];
    const app: AutoLaunchApp = {
      getLoginItemSettings: () => ({ openAtLogin: false }),
      setLoginItemSettings: (settings) => {
        calls.push(settings);
      }
    };
    const template = buildTrayMenuTemplate(
      createDeps({
        setAutoLaunchEnabled: (enabled) => {
          setAutoLaunchEnabled(app, enabled);
        }
      })
    );
    const autoLaunchItem = findItem(template, '开机时启动');

    // Electron flips the checkbox state before invoking click, so menuItem.checked is the next value.
    autoLaunchItem?.click?.({ checked: true });
    autoLaunchItem?.click?.({ checked: false });

    expect(calls).toEqual([
      { openAtLogin: true, openAsHidden: false },
      { openAtLogin: false, openAsHidden: false }
    ]);
  });

  it('routes note, update, release, and exit actions to the injected callbacks', () => {
    const createNote = vi.fn();
    const restoreNotes = vi.fn();
    const checkForUpdates = vi.fn();
    const showCurrentRelease = vi.fn();
    const quit = vi.fn();
    const template = buildTrayMenuTemplate(
      createDeps({
        createNote,
        restoreNotes,
        checkForUpdates,
        showCurrentRelease,
        quit
      } as Partial<TrayMenuDeps>)
    );

    findItem(template, '新建便签')?.click?.({});
    findItem(template, '显示所有便签')?.click?.({});
    findItem(template, '检查更新')?.click?.({});
    findItem(template, '版本 0.1.14')?.click?.({});
    findItem(template, '退出')?.click?.({});

    expect(createNote).toHaveBeenCalledTimes(1);
    expect(restoreNotes).toHaveBeenCalledTimes(1);
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
    expect(showCurrentRelease).toHaveBeenCalledTimes(1);
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('hides 检查更新 when the current build does not support auto-update', () => {
    const deps = createDeps();
    delete (deps as Partial<TrayMenuDeps>).checkForUpdates;

    expect(findItem(buildTrayMenuTemplate(deps), '检查更新')).toBeUndefined();
  });

  it('adds only one compact version item before the separator', () => {
    const template = buildTrayMenuTemplate(createDeps());
    const versionItems = template.filter((item) => item.label?.startsWith('版本 '));
    const versionIndex = template.findIndex((item) => item.label === '版本 0.1.14');
    const separatorIndex = template.findIndex((item) => item.type === 'separator');

    expect(versionItems).toHaveLength(1);
    expect(versionIndex).toBe(separatorIndex - 1);
    expect(template.some((item) => item.label?.includes('关于'))).toBe(false);
    expect(template.some((item) => item.label?.includes('查看本版更新'))).toBe(false);
  });

  it('names the tray 悬浮便签', () => {
    expect(TRAY_TOOLTIP).toBe('悬浮便签');
  });
});

describe('tray wiring', () => {
  const mainSource = readFileSync(resolve(__dirname, '../main/main.ts'), 'utf8');

  it('creates the tray from the main process on app ready', () => {
    expect(mainSource).toContain("from './tray'");
    expect(mainSource).toContain('createTray(');
  });

  it('uses one app instance and restores closed notes from a second launch', () => {
    expect(mainSource).toContain('app.requestSingleInstanceLock()');
    expect(mainSource).toContain("app.on('second-instance'");
    expect(mainSource).toContain('restoreClosedNotes()');
  });

  it('uses the packaged tray icon asset instead of an inline placeholder', () => {
    const traySource = readFileSync(resolve(__dirname, '../main/tray.ts'), 'utf8');

    expect(traySource).toContain('tray-icon.png');
    expect(traySource).toContain('createFromPath');
    expect(traySource).not.toContain('createFromDataURL');
  });
});
