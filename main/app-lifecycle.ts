import { join } from 'node:path';

export function shouldQuitWhenAllWindowsClosed(platform: NodeJS.Platform): boolean {
  return platform === 'linux';
}

export function shouldCreateWindowOnActivate(windowCount: number): boolean {
  return windowCount === 0;
}

// 开发环境与正式版共用同一安装身份,默认读写同一份 userData。dev 改到独立
// 目录,保证开发中的删除/调试永远碰不到正式数据;正式版路径保持
// <appData>/floating-sticky-notes 不变。
export const DEV_USER_DATA_DIR_NAME = 'floating-sticky-notes-dev';

export function getDevUserDataPath(appDataPath: string): string {
  return join(appDataPath, DEV_USER_DATA_DIR_NAME);
}
