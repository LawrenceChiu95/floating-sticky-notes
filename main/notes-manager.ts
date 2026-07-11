import {
  createDefaultNote,
  clampNoteOpacity,
  isNoteColor,
  MAX_NOTE_COUNT,
  type NoteBounds,
  type NoteChecklistItemRecord,
  type NoteImageRecord,
  type NoteRecord
} from './note-state';
import type { NoteImageStorage, SaveImageInput } from './image-storage';
import type { NotesDocument } from './storage';

export type ManagedNoteWindow = {
  webContentsId: number;
  getBounds: () => NoteBounds;
  onBoundsChanged: (listener: () => void | Promise<void>) => void;
  onClose: (listener: () => void) => void;
  flushPendingChanges: () => Promise<void>;
  show: () => void;
  close: () => void;
};

export type CreateManagedNoteWindow = (note: NoteRecord) => ManagedNoteWindow;
export type NoteImageView = NoteImageRecord & {
  src: string;
};
export type NoteView = Omit<NoteRecord, 'images'> & {
  images: NoteImageView[];
};
export type CreateNoteResult =
  | {
      ok: true;
      note: NoteView;
    }
  | {
      ok: false;
      reason: 'max-notes';
    };
export type AddImageResult =
  | {
      ok: true;
      note: NoteView;
    }
  | {
      ok: false;
      reason: 'note-not-found' | 'image-storage-unavailable';
    };
export type DeleteImageResult =
  | {
      ok: true;
      note: NoteView;
    }
  | {
      ok: false;
      reason: 'note-not-found' | 'image-not-found';
    };
export type NoteAppearanceInput = {
  color?: string;
  opacity?: number;
};

type NotesStorage = {
  load: () => Promise<NotesDocument>;
  save: (document: NotesDocument) => Promise<void>;
};

type NotesManagerOptions = {
  storage: NotesStorage;
  createWindow: CreateManagedNoteWindow;
  imageStorage?: NoteImageStorage;
  createId?: () => string;
  now?: () => string;
  maxNotes?: number;
};

export class NotesManager {
  private readonly storage: NotesStorage;
  private readonly createWindow: CreateManagedNoteWindow;
  private readonly imageStorage?: NoteImageStorage;
  private readonly createId?: () => string;
  private readonly now: () => string;
  private readonly maxNotes: number;
  private readonly notesById = new Map<string, NoteRecord>();
  private readonly windowsByNoteId = new Map<string, ManagedNoteWindow>();
  private readonly noteIdByWebContentsId = new Map<number, string>();
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(options: NotesManagerOptions) {
    this.storage = options.storage;
    this.createWindow = options.createWindow;
    this.imageStorage = options.imageStorage;
    this.createId = options.createId;
    this.now = options.now ?? (() => new Date().toISOString());
    this.maxNotes = options.maxNotes ?? MAX_NOTE_COUNT;
  }

  async start(): Promise<void> {
    const document = await this.storage.load();
    const notes =
      document.notes.length > 0
        ? document.notes
        : [
            createDefaultNote({
              id: this.createId?.(),
              now: this.now()
            })
          ];

    this.replaceNotes(notes);

    if (document.notes.length === 0 || document.notes.length > this.maxNotes) {
      await this.persist();
    }

    for (const note of this.notesById.values()) {
      this.createWindowForNote(note);
    }
  }

  restoreClosedNotes(): number {
    let restoredCount = 0;

    for (const note of this.notesById.values()) {
      const existingWindow = this.windowsByNoteId.get(note.id);
      if (existingWindow) {
        existingWindow.show();
        continue;
      }

      this.createWindowForNote(note);
      restoredCount += 1;
    }

    return restoredCount;
  }

  async createNote(): Promise<CreateNoteResult> {
    if (this.notesById.size >= this.maxNotes) {
      return {
        ok: false,
        reason: 'max-notes'
      };
    }

    const note = createDefaultNote({
      id: this.createId?.(),
      now: this.now()
    });

    this.notesById.set(note.id, note);
    this.createWindowForNote(note);
    await this.persist();

    return {
      ok: true,
      note: this.toNoteView(note)
    };
  }

  async updateContentForWebContents(
    webContentsId: number,
    content: string
  ): Promise<NoteView | undefined> {
    const note = this.getMutableNoteForWebContents(webContentsId);

    if (!note) {
      return undefined;
    }

    note.content = content;
    note.updatedAt = this.now();
    await this.persist();

    return this.toNoteView(note);
  }

  async updateNameForWebContents(
    webContentsId: number,
    name: string
  ): Promise<NoteView | undefined> {
    const note = this.getMutableNoteForWebContents(webContentsId);

    if (!note) {
      return undefined;
    }

    note.name = name;
    note.updatedAt = this.now();
    await this.persist();

    return this.toNoteView(note);
  }

  async updateChecklistForWebContents(
    webContentsId: number,
    checklist: NoteChecklistItemRecord[]
  ): Promise<NoteView | undefined> {
    const note = this.getMutableNoteForWebContents(webContentsId);

    if (!note) {
      return undefined;
    }

    note.checklist = checklist.map((item) => ({ ...item }));
    note.updatedAt = this.now();
    await this.persist();

    return this.toNoteView(note);
  }

  async updateAppearanceForWebContents(
    webContentsId: number,
    input: NoteAppearanceInput
  ): Promise<NoteView | undefined> {
    const note = this.getMutableNoteForWebContents(webContentsId);

    if (!note) {
      return undefined;
    }

    const hasColor = input.color !== undefined;
    const hasOpacity = input.opacity !== undefined;

    if (!hasColor && !hasOpacity) {
      return undefined;
    }

    if (hasColor && (typeof input.color !== 'string' || !isNoteColor(input.color))) {
      return undefined;
    }

    if (hasOpacity && (typeof input.opacity !== 'number' || !Number.isFinite(input.opacity))) {
      return undefined;
    }

    if (hasColor) {
      note.color = input.color as string;
    }

    if (hasOpacity) {
      note.opacity = clampNoteOpacity(input.opacity as number);
    }

    note.updatedAt = this.now();
    await this.persist();

    return this.toNoteView(note);
  }

  async addImageForWebContents(
    webContentsId: number,
    imageInput: SaveImageInput
  ): Promise<AddImageResult> {
    const note = this.getMutableNoteForWebContents(webContentsId);

    if (!note) {
      return {
        ok: false,
        reason: 'note-not-found'
      };
    }

    if (!this.imageStorage) {
      return {
        ok: false,
        reason: 'image-storage-unavailable'
      };
    }

    const image = await this.imageStorage.saveImage(imageInput);
    note.images = [...note.images, image];
    note.updatedAt = this.now();
    await this.persist();

    return {
      ok: true,
      note: this.toNoteView(note)
    };
  }

  async deleteImageForWebContents(
    webContentsId: number,
    imageId: string
  ): Promise<DeleteImageResult> {
    const note = this.getMutableNoteForWebContents(webContentsId);

    if (!note) {
      return {
        ok: false,
        reason: 'note-not-found'
      };
    }

    const image = note.images.find((candidate) => candidate.id === imageId);

    if (!image) {
      return {
        ok: false,
        reason: 'image-not-found'
      };
    }

    note.images = note.images.filter((candidate) => candidate.id !== imageId);
    note.updatedAt = this.now();
    await this.persist();
    await this.deleteImagesIfUnused([image]);

    return {
      ok: true,
      note: this.toNoteView(note)
    };
  }

  async deleteNoteForWebContents(webContentsId: number): Promise<boolean> {
    const noteId = this.noteIdByWebContentsId.get(webContentsId);

    if (!noteId) {
      return false;
    }

    const noteWindow = this.windowsByNoteId.get(noteId);
    const note = this.notesById.get(noteId);
    this.notesById.delete(noteId);
    this.windowsByNoteId.delete(noteId);
    this.noteIdByWebContentsId.delete(webContentsId);
    await this.persist();
    await this.deleteImagesIfUnused(note?.images ?? []);
    noteWindow?.close();

    return true;
  }

  getNoteForWebContents(webContentsId: number): NoteView | undefined {
    const note = this.getMutableNoteForWebContents(webContentsId);
    return note ? this.toNoteView(note) : undefined;
  }

  async flushPendingSaves(): Promise<void> {
    await Promise.all(
      Array.from(this.windowsByNoteId.values(), (noteWindow) => noteWindow.flushPendingChanges())
    );
    await this.persistQueue;
  }

  private replaceNotes(notes: NoteRecord[]): void {
    this.notesById.clear();

    for (const note of notes.slice(0, this.maxNotes)) {
      this.notesById.set(note.id, note);
    }
  }

  private createWindowForNote(note: NoteRecord): ManagedNoteWindow {
    const noteWindow = this.createWindow(note);
    this.windowsByNoteId.set(note.id, noteWindow);
    this.noteIdByWebContentsId.set(noteWindow.webContentsId, note.id);

    noteWindow.onBoundsChanged(() => {
      return this.updateBoundsForWebContents(noteWindow.webContentsId, noteWindow.getBounds());
    });
    noteWindow.onClose(() => {
      this.windowsByNoteId.delete(note.id);
      this.noteIdByWebContentsId.delete(noteWindow.webContentsId);
    });

    return noteWindow;
  }

  private async updateBoundsForWebContents(
    webContentsId: number,
    bounds: NoteBounds
  ): Promise<void> {
    const note = this.getMutableNoteForWebContents(webContentsId);

    if (!note) {
      return;
    }

    note.bounds = bounds;
    note.updatedAt = this.now();
    await this.persist();
  }

  private getMutableNoteForWebContents(webContentsId: number): NoteRecord | undefined {
    const noteId = this.noteIdByWebContentsId.get(webContentsId);
    return noteId ? this.notesById.get(noteId) : undefined;
  }

  private async persist(): Promise<void> {
    const document = {
      version: 1,
      notes: Array.from(this.notesById.values(), cloneNote)
    } satisfies NotesDocument;
    const saveOperation = this.persistQueue.then(() => this.storage.save(document));
    this.persistQueue = saveOperation.catch(() => undefined);
    await saveOperation;
  }

  private async deleteImagesIfUnused(images: NoteImageRecord[]): Promise<void> {
    const imageStorage = this.imageStorage;

    if (!imageStorage) {
      return;
    }

    const unusedImages = images.filter((image) => !this.isImageFilenameReferenced(image.filename));
    await Promise.all(
      unusedImages.map((image) => imageStorage.deleteImage(image).catch(() => undefined))
    );
  }

  private isImageFilenameReferenced(filename: string): boolean {
    return Array.from(this.notesById.values()).some((note) =>
      note.images.some((image) => image.filename === filename)
    );
  }

  private toNoteView(note: NoteRecord): NoteView {
    return {
      ...cloneNote(note),
      images: note.images.map((image) => ({
        ...image,
        src: this.imageStorage?.getImageSource(image) ?? ''
      }))
    };
  }
}

function cloneNote(note: NoteRecord): NoteRecord {
  return {
    ...note,
    bounds: {
      ...note.bounds
    },
    checklist: note.checklist.map((item) => ({
      ...item
    })),
    images: note.images.map((image) => ({
      ...image
    }))
  };
}
