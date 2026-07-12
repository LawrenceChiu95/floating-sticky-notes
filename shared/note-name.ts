export const MAX_NOTE_NAME_LENGTH = 60;
export const DEFAULT_NOTE_WINDOW_TITLE = '悬浮便签';

export function limitNoteNameLength(name: string): string {
  return Array.from(name).slice(0, MAX_NOTE_NAME_LENGTH).join('');
}

export function normalizeNoteName(name: string): string {
  return limitNoteNameLength(name.trim());
}

export function getNoteWindowTitle(name: string): string {
  return name || DEFAULT_NOTE_WINDOW_TITLE;
}
