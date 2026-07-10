import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(
  readFileSync(resolve(__dirname, '../package.json'), 'utf8')
) as {
  version?: string;
  private?: boolean;
  license?: string;
  engines?: Record<string, string>;
  dependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  build?: {
    appId?: string;
    productName?: string;
    asarUnpack?: string[];
    files?: string[];
    directories?: {
      output?: string;
    };
    win?: {
      icon?: string;
      signAndEditExecutable?: boolean;
      target?: Array<string | { target: string; arch?: string[] }>;
    };
    nsis?: {
      oneClick?: boolean;
      perMachine?: boolean;
      installerIcon?: string;
      uninstallerIcon?: string;
      deleteAppDataOnUninstall?: boolean;
      include?: string;
    };
    mac?: {
      icon?: string;
      category?: string;
      target?: Array<string | { target: string; arch?: string[] }>;
    };
  };
};

describe('package configuration', () => {
  it('uses 0.1.9 as the first auto-update release', () => {
    expect(packageJson.version).toBe('0.1.9');
    expect(packageJson.dependencies?.['electron-updater']).toBe('6.8.9');
    expect(packageJson.dependencies?.semver).toBe('7.8.5');
    expect(packageJson.dependencies?.yaml).toBe('2.9.0');
  });

  it('is MIT licensed while remaining protected from accidental npm publication', () => {
    expect(packageJson.license).toBe('MIT');
    expect(packageJson.private).toBe(true);
    expect(packageJson.engines).toEqual({ node: '>=22 <23', npm: '>=10 <11' });
  });

  it('has one public Windows build and one generic Mac build', () => {
    expect(packageJson.scripts?.['build:icons']).toBe('electron scripts/build-windows-icons.cjs');
    expect(packageJson.scripts?.['dist:win']).toBe('node scripts/build-windows.cjs');
    expect(packageJson.scripts?.['dist:win:custom']).toBeUndefined();
    expect(packageJson.scripts?.['dist:win:standard']).toBeUndefined();
    expect(packageJson.scripts?.['dist:win:all']).toBeUndefined();
    expect(packageJson.scripts?.['build:mac-icons']).toBe('node scripts/build-mac-icons.cjs');
    expect(packageJson.scripts?.['dist:mac']).toBe(
      'npm run build:mac-icons && node scripts/build-mac.cjs'
    );

    const publicBuildScript = readFileSync(resolve(__dirname, '../scripts/build-windows.cjs'), 'utf8');
    expect(publicBuildScript).toContain('StickyNotes-Setup-${version}.${ext}');
    expect(publicBuildScript).toContain("channel: 'latest'");

    const buildHelper = readFileSync(resolve(__dirname, '../scripts/windows-build.cjs'), 'utf8');
    expect(buildHelper).toContain('--config.nsis.artifactName=');
    expect(buildHelper).not.toContain('portable');
    expect(buildHelper).toContain(
      'https://github.com/LawrenceChiu95/floating-sticky-notes-updates/releases/latest/download'
    );
    expect(buildHelper).toContain('--config.publish.provider=generic');
    expect(buildHelper).toContain('--config.publish.channel=');
    expect(buildHelper).toContain('--publish');
    expect(buildHelper).toContain('never');

    const macBuildScript = readFileSync(
      resolve(__dirname, '../scripts/build-mac.cjs'),
      'utf8'
    );
    expect(macBuildScript).toContain('release-mac');
    expect(macBuildScript).toContain('--mac');
    expect(macBuildScript).toContain('--arm64');
    expect(macBuildScript).toContain('StickyNotes-Mac-${version}.${ext}');
    expect(macBuildScript).toContain('--config.publish.provider=generic');
    expect(macBuildScript).toContain('--config.publish.channel=latest');
    expect(macBuildScript).toContain('--publish');
    expect(macBuildScript).toContain('never');
    expect(macBuildScript).toContain(
      'https://github.com/LawrenceChiu95/floating-sticky-notes-updates/releases/latest/download'
    );
  });

  it('keeps build outputs and local environment files out of git', () => {
    const gitignore = readFileSync(resolve(__dirname, '../.gitignore'), 'utf8');

    expect(gitignore).toContain('release/');
    expect(gitignore).toContain('release-mac/');
    expect(gitignore).toContain('.env.*');
  });

  it('configures an unsigned Windows NSIS Setup installer only (no portable target)', () => {
    expect(packageJson.build?.appId).toBe('local.lawrence.floating-sticky-notes');
    expect(packageJson.build?.productName).toBe('悬浮便签');
    expect(packageJson.build?.directories?.output).toBe('release');
    expect(packageJson.build?.files).toContain('assets/icons/tray-icon.png');
    expect(packageJson.build?.files).toContain('assets/icons/app-icon.ico');
    expect(packageJson.build?.asarUnpack).toContain('assets/icons/**');
    expect(packageJson.build?.win?.target).toEqual([
      { target: 'nsis', arch: ['x64'] }
    ]);
    expect(packageJson.build?.win?.icon).toBe('assets/icons/app-icon.ico');
    expect(packageJson.build?.win?.signAndEditExecutable).not.toBe(false);
    expect(packageJson.build?.nsis).toMatchObject({
      oneClick: false,
      perMachine: false,
      installerIcon: 'assets/icons/app-icon.ico',
      uninstallerIcon: 'assets/icons/app-icon.ico',
      deleteAppDataOnUninstall: false,
      include: 'build/installer.nsh'
    });
  });

  it('configures an unsigned Apple Silicon Mac package', () => {
    expect(packageJson.build?.files).toContain('assets/icons/app-icon.icns');
    expect(packageJson.build?.mac?.target).toEqual([
      { target: 'dmg', arch: ['arm64'] }
    ]);
    expect(packageJson.build?.mac?.icon).toBe('assets/icons/app-icon.icns');
    expect(packageJson.build?.mac?.category).toBe('public.app-category.productivity');
  });

  it('bypasses legacy uninstallers during upgrades so old close checks cannot block reinstall', () => {
    const includePath = packageJson.build?.nsis?.include;
    expect(includePath).toBe('build/installer.nsh');

    const installerInclude = readFileSync(resolve(__dirname, '../build/installer.nsh'), 'utf8');
    expect(installerInclude).toContain('!macro customInit');
    expect(installerInclude).toContain('DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "UninstallString"');
    expect(installerInclude).toContain('DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "QuietUninstallString"');
    expect(installerInclude).toContain('bypassLegacyUninstaller');
  });

  it('refreshes existing shortcuts during install so stale Electron icons are replaced', () => {
    const installerInclude = readFileSync(resolve(__dirname, '../build/installer.nsh'), 'utf8');

    expect(installerInclude).toContain('!macro customInstall');
    expect(installerInclude).toContain('refreshShortcutIcon');
    expect(installerInclude).toContain('resources\\app.asar.unpacked\\assets\\icons\\app-icon.ico');
    expect(installerInclude).toContain('StrCpy $0 "$appExe"');
    expect(installerInclude).toContain('Delete "$newDesktopLink"');
    expect(installerInclude).toContain('CreateShortCut "$newDesktopLink" "$appExe" "" "$0"');
    expect(installerInclude).toContain('Delete "$newStartMenuLink"');
    expect(installerInclude).toContain('CreateShortCut "$newStartMenuLink" "$appExe" "" "$0"');
  });

  it('ships icon assets for the Windows app and tray', () => {
    expect(existsSync(resolve(__dirname, '../assets/icons/app-icon.ico'))).toBe(true);
    expect(existsSync(resolve(__dirname, '../assets/icons/app-icon.icns'))).toBe(true);
    expect(existsSync(resolve(__dirname, '../assets/icons/tray-icon.png'))).toBe(true);
  });

  it('uses traditional DIB icon entries for Windows shell compatibility', () => {
    const icon = readFileSync(resolve(__dirname, '../assets/icons/app-icon.ico'));
    const entryCount = icon.readUInt16LE(4);

    expect(entryCount).toBeGreaterThanOrEqual(6);
    for (let index = 0; index < entryCount; index += 1) {
      const entryOffset = 6 + index * 16;
      const imageOffset = icon.readUInt32LE(entryOffset + 12);

      expect(icon.readUInt32LE(imageOffset)).toBe(40);
    }
  });
});
