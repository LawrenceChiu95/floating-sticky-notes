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
