import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  DEFAULT_NOTE_BOUNDS,
  DEFAULT_NOTE_COLOR,
  DEFAULT_NOTE_OPACITY,
  clampNoteOpacity,
  isNoteColor,
  type NoteBounds,
  type NoteChecklistItemRecord,
  type NoteDock,
  type NoteImageRecord,
  type NoteRecord
} from './note-state';
import { isSafeImageFilename } from './image-storage';
import {
  normalizeChecklistHierarchy,
  readChecklistParentId
} from './checklist-hierarchy';

export type NotesDocument = {
  version: 1;
  notes: NoteRecord[];
};

export type NotesStorageLogger = (event: string, error: unknown) => void;

export class JsonNotesStorage {
  constructor(
    private readonly filePath: string,
    private readonly logError: NotesStorageLogger = () => undefined
  ) {}

  async load(): Promise<NotesDocument> {
    try {
      return await readDocument(this.filePath);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return createEmptyDocument();
      }

      this.logError('notes_primary_load_failed', error);
      return this.loadBackupOrEmpty();
    }
  }

  async save(document: NotesDocument): Promise<void> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await this.backupCurrentDocument();
      await writeFile(this.filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    } catch (error) {
      this.logError('notes_save_failed', error);
      throw error;
    }
  }

  private get backupPath(): string {
    return join(dirname(this.filePath), 'notes.backup.json');
  }

  private async backupCurrentDocument(): Promise<void> {
    try {
      await copyFile(this.filePath, this.backupPath);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return;
      }

      throw error;
    }
  }

  private async loadBackupOrEmpty(): Promise<NotesDocument> {
    try {
      return await readDocument(this.backupPath);
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') {
        this.logError('notes_backup_load_failed', error);
      }
      return createEmptyDocument();
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

async function readDocument(filePath: string): Promise<NotesDocument> {
  const raw = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  const document = normalizeNotesDocument(parsed);

  if (!document) {
    throw new Error('Notes document has an invalid shape');
  }

  return document;
}

function createEmptyDocument(): NotesDocument {
  return {
    version: 1,
    notes: []
  };
}

function normalizeNotesDocument(value: unknown): NotesDocument | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<NotesDocument>;

  if (candidate.version !== 1 || !Array.isArray(candidate.notes)) {
    return undefined;
  }

  return {
    version: 1,
    notes: candidate.notes.flatMap((note) => {
      const normalizedNote = normalizeNoteRecord(note);
      return normalizedNote ? [normalizedNote] : [];
    })
  };
}

function normalizeNoteRecord(value: unknown): NoteRecord | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<Record<keyof NoteRecord, unknown>>;

  if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
    return undefined;
  }

  const dock = normalizeNoteDock(candidate.dock);

  return {
    id: candidate.id,
    name: typeof candidate.name === 'string' ? candidate.name : '',
    content: typeof candidate.content === 'string' ? candidate.content : '',
    bounds: normalizeNoteBounds(candidate.bounds),
    ...(dock ? { dock } : {}),
    color:
      typeof candidate.color === 'string' && isNoteColor(candidate.color)
        ? candidate.color
        : DEFAULT_NOTE_COLOR,
    opacity:
      typeof candidate.opacity === 'number' && Number.isFinite(candidate.opacity)
        ? clampNoteOpacity(candidate.opacity)
        : DEFAULT_NOTE_OPACITY,
    checklist: normalizeNoteChecklist(candidate.checklist),
    images: normalizeNoteImages(candidate.images),
    syncStatus: 'local',
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : '',
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : ''
  };
}

function normalizeNoteDock(value: unknown): NoteDock | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as { side?: unknown; y?: unknown; x?: unknown };

  if (candidate.side !== 'left' && candidate.side !== 'right') {
    return undefined;
  }

  if (typeof candidate.y !== 'number' || !Number.isFinite(candidate.y)) {
    return undefined;
  }

  // x 是多屏认屏证据（旧记录没有）：不是有限数字就当缺省，不拖垮整条记录。
  const x =
    typeof candidate.x === 'number' && Number.isFinite(candidate.x) ? candidate.x : undefined;

  return { side: candidate.side, y: candidate.y, ...(x === undefined ? {} : { x }) };
}

function normalizeNoteChecklist(value: unknown): NoteChecklistItemRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const items = value.flatMap((item) => {
    const normalizedItem = normalizeNoteChecklistItem(item);
    return normalizedItem ? [normalizedItem] : [];
  });

  return normalizeChecklistHierarchy(items);
}

function normalizeNoteChecklistItem(value: unknown): NoteChecklistItemRecord | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<Record<keyof NoteChecklistItemRecord, unknown>>;

  if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
    return undefined;
  }

  return {
    id: candidate.id,
    text: typeof candidate.text === 'string' ? candidate.text : '',
    checked: typeof candidate.checked === 'boolean' ? candidate.checked : false,
    ...(readChecklistParentId(candidate.parentId)
      ? { parentId: readChecklistParentId(candidate.parentId) }
      : {}),
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : '',
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : ''
  };
}

function normalizeNoteImages(value: unknown): NoteImageRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((image) => {
    const normalizedImage = normalizeNoteImageRecord(image);
    return normalizedImage ? [normalizedImage] : [];
  });
}

function normalizeNoteImageRecord(value: unknown): NoteImageRecord | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<Record<keyof NoteImageRecord, unknown>>;

  if (
    typeof candidate.id !== 'string' ||
    candidate.id.length === 0 ||
    typeof candidate.filename !== 'string' ||
    !isSafeImageFilename(candidate.filename)
  ) {
    return undefined;
  }

  return {
    id: candidate.id,
    filename: candidate.filename,
    width: getPositiveFiniteNumber(candidate.width) ?? 0,
    height: getPositiveFiniteNumber(candidate.height) ?? 0,
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : ''
  };
}

function normalizeNoteBounds(value: unknown): NoteBounds {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_NOTE_BOUNDS };
  }

  const candidate = value as Partial<Record<keyof NoteBounds, unknown>>;
  const bounds: NoteBounds = {
    width: getPositiveFiniteNumber(candidate.width) ?? DEFAULT_NOTE_BOUNDS.width,
    height: getPositiveFiniteNumber(candidate.height) ?? DEFAULT_NOTE_BOUNDS.height
  };
  const x = getFiniteNumber(candidate.x);
  const y = getFiniteNumber(candidate.y);

  if (x !== undefined) {
    bounds.x = x;
  }

  if (y !== undefined) {
    bounds.y = y;
  }

  return bounds;
}

function getFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getPositiveFiniteNumber(value: unknown): number | undefined {
  const numberValue = getFiniteNumber(value);
  return numberValue !== undefined && numberValue > 0 ? numberValue : undefined;
}
