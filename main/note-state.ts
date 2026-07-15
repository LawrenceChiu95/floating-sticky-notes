import { randomUUID } from 'node:crypto';
import { DEFAULT_NOTE_COLOR, DEFAULT_NOTE_OPACITY } from '../shared/note-appearance';

export {
  DEFAULT_NOTE_COLOR,
  DEFAULT_NOTE_OPACITY,
  MAX_NOTE_OPACITY,
  MIN_NOTE_OPACITY,
  NOTE_COLORS,
  NOTE_COLOR_VALUES,
  clampNoteOpacity,
  isNoteColor
} from '../shared/note-appearance';

export const MAX_NOTE_COUNT = 20;
export const DEFAULT_NOTE_BOUNDS = {
  width: 280,
  height: 220
} as const;

export type NoteBounds = {
  x?: number;
  y?: number;
  width: number;
  height: number;
};

export type NoteImageRecord = {
  id: string;
  filename: string;
  width: number;
  height: number;
  createdAt: string;
};

export type NoteChecklistItemRecord = {
  id: string;
  text: string;
  checked: boolean;
  parentId?: string;
  createdAt: string;
  updatedAt: string;
};

export type NoteRecord = {
  id: string;
  name: string;
  content: string;
  bounds: NoteBounds;
  color: string;
  opacity: number;
  checklist: NoteChecklistItemRecord[];
  images: NoteImageRecord[];
  syncStatus: 'local';
  createdAt: string;
  updatedAt: string;
};

type CreateDefaultNoteOptions = {
  id?: string;
  now?: string;
};

export function createDefaultNote(options: CreateDefaultNoteOptions = {}): NoteRecord {
  const timestamp = options.now ?? new Date().toISOString();

  return {
    id: options.id ?? randomUUID(),
    name: '',
    content: '',
    bounds: { ...DEFAULT_NOTE_BOUNDS },
    color: DEFAULT_NOTE_COLOR,
    opacity: DEFAULT_NOTE_OPACITY,
    checklist: [],
    images: [],
    syncStatus: 'local',
    createdAt: timestamp,
    updatedAt: timestamp
  };
}
