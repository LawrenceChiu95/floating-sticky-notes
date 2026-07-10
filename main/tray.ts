import { Menu, type MenuItem, nativeImage, Tray } from 'electron';
import { join } from 'node:path';
import { buildTrayMenuTemplate, TRAY_TOOLTIP, type TrayMenuDeps } from './tray-menu';

const TRAY_ICON_PATH = join(__dirname, '../../assets/icons/tray-icon.png');

// Hold the Tray reference for the app lifetime; if it is garbage collected the
// icon disappears from the tray.
let tray: Tray | undefined;

export function createTray(deps: TrayMenuDeps): Tray {
  const icon = nativeImage.createFromPath(TRAY_ICON_PATH);
  tray = new Tray(icon);
  tray.setToolTip(TRAY_TOOLTIP);

  const menu = Menu.buildFromTemplate(
    buildTrayMenuTemplate(deps).map((item) => ({
      label: item.label,
      type: item.type,
      checked: item.checked,
      click: item.click
        ? (menuItem: MenuItem): void => item.click?.({ checked: menuItem.checked })
        : undefined
    }))
  );
  tray.setContextMenu(menu);

  return tray;
}
