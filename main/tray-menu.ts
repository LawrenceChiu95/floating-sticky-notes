export type TrayMenuItemTemplate = {
  label?: string;
  type?: 'normal' | 'checkbox' | 'separator';
  checked?: boolean;
  click?: (menuItem: { checked?: boolean }) => void;
};

export type TrayMenuDeps = {
  getAutoLaunchEnabled: () => boolean;
  setAutoLaunchEnabled: (enabled: boolean) => void;
  createNote: () => void;
  restoreNotes: () => void;
  checkForUpdates?: () => void;
  currentVersion: string;
  showCurrentRelease: () => void;
  quit: () => void;
};

export const TRAY_TOOLTIP = '悬浮便签';

/**
 * Pure tray-menu description. Kept free of Electron imports so it can be unit
 * tested; `tray.ts` adapts this to `Menu.buildFromTemplate`. The 开机时启动 item
 * is the only surface that owns the global auto-launch setting.
 */
export function buildTrayMenuTemplate(deps: TrayMenuDeps): TrayMenuItemTemplate[] {
  const template: TrayMenuItemTemplate[] = [
    {
      label: '新建便签',
      type: 'normal',
      click: () => deps.createNote()
    },
    {
      label: '显示所有便签',
      type: 'normal',
      click: () => deps.restoreNotes()
    },
    {
      label: '开机时启动',
      type: 'checkbox',
      checked: deps.getAutoLaunchEnabled(),
      // Electron toggles menuItem.checked before invoking click, so it already
      // holds the next value the user asked for.
      click: (menuItem) => deps.setAutoLaunchEnabled(menuItem.checked === true)
    }
  ];

  const checkForUpdates = deps.checkForUpdates;
  if (checkForUpdates) {
    template.push({
      label: '检查更新',
      type: 'normal',
      click: () => checkForUpdates()
    });
  }

  template.push(
    {
      label: `版本 ${deps.currentVersion}`,
      type: 'normal',
      click: () => deps.showCurrentRelease()
    },
    { type: 'separator' },
    {
      label: '退出',
      type: 'normal',
      click: () => deps.quit()
    }
  );

  return template;
}
