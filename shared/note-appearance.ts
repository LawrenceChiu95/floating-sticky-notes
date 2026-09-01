export const NOTE_COLORS = {
  paperYellow: '#FFF3B0',
  softGreen: '#DDF7D0',
  softBlue: '#D8ECFF',
  softPink: '#FFDCE8',
  plainWhite: '#FAFAF7'
} as const;
export const DEFAULT_NOTE_COLOR = NOTE_COLORS.paperYellow;
export const DEFAULT_NOTE_OPACITY = 0.94;
export const MIN_NOTE_OPACITY = 0.3;
export const MAX_NOTE_OPACITY = 1;
export const NOTE_COLOR_VALUES: readonly string[] = Object.values(NOTE_COLORS);

export function isNoteColor(value: string): boolean {
  return NOTE_COLOR_VALUES.includes(value);
}

export function clampNoteOpacity(value: number): number {
  return Math.min(MAX_NOTE_OPACITY, Math.max(MIN_NOTE_OPACITY, value));
}

// 便签纸色带透明度。便签主窗与书签头窗（窗口交接架构）都要用同一套着色，
// 所以放在 shared，不再由 renderer 入口文件私有。
export function hexToRgba(hex: string, alpha: number): string {
  const normalizedHex = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : DEFAULT_NOTE_COLOR;
  const red = Number.parseInt(normalizedHex.slice(1, 3), 16);
  const green = Number.parseInt(normalizedHex.slice(3, 5), 16);
  const blue = Number.parseInt(normalizedHex.slice(5, 7), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

// Popover surfaces ("更多"菜单、删除确认)从便签纸色向白抬升,读作同一张纸
// 上抬起的纸片,而不是贴上去的系统面板。alpha 固定高位,低透明度便签上仍可读。
export function noteColorToMenuSurface(hex: string): string {
  const normalizedHex = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : DEFAULT_NOTE_COLOR;
  const lift = (channel: number): number => Math.round(channel + (255 - channel) * 0.55);

  return `rgba(${lift(Number.parseInt(normalizedHex.slice(1, 3), 16))}, ${lift(
    Number.parseInt(normalizedHex.slice(3, 5), 16)
  )}, ${lift(Number.parseInt(normalizedHex.slice(5, 7), 16))}, 0.97)`;
}
