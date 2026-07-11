export function shouldQuitWhenAllWindowsClosed(platform: NodeJS.Platform): boolean {
  return platform === 'linux';
}

export function shouldCreateWindowOnActivate(windowCount: number): boolean {
  return windowCount === 0;
}
