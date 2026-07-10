export type AutoLaunchStatus = {
  enabled: boolean;
};

type LoginItemSettings = {
  openAtLogin: boolean;
};

type LoginItemSettingsInput = {
  openAtLogin: boolean;
  openAsHidden: boolean;
};

export type AutoLaunchApp = {
  getLoginItemSettings: () => LoginItemSettings;
  setLoginItemSettings: (settings: LoginItemSettingsInput) => void;
};

export type AutoLaunchDefaultState = {
  hasAppliedDefault: () => boolean;
  markDefaultApplied: () => void;
};

export function getAutoLaunchStatus(app: Pick<AutoLaunchApp, 'getLoginItemSettings'>): AutoLaunchStatus {
  return {
    enabled: app.getLoginItemSettings().openAtLogin
  };
}

export function setAutoLaunchEnabled(
  app: AutoLaunchApp,
  enabled: boolean
): AutoLaunchStatus {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: false
  });

  return getAutoLaunchStatus(app);
}

export function ensureAutoLaunchDefaultEnabled(
  app: AutoLaunchApp,
  defaultState: AutoLaunchDefaultState
): AutoLaunchStatus {
  if (!defaultState.hasAppliedDefault()) {
    setAutoLaunchEnabled(app, true);
    defaultState.markDefaultApplied();
  }

  return getAutoLaunchStatus(app);
}
