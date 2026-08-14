import {
  createDefaultNote,
  clampNoteOpacity,
  isNoteColor,
  MAX_NOTE_COUNT,
  type NoteBounds,
  type NoteChecklistItemRecord,
  type NoteDock,
  type NoteImageRecord,
  type NoteRecord
} from './note-state';
import type { NoteImageStorage, SaveImageInput } from './image-storage';
import type {
  NoteWindowDockTransition,
  NoteWindowPresentation
} from './note-window-collapse';
import type { NotesDocument } from './storage';
import { offsetDockYToAvoidOverlap, type DisplayWorkArea } from '../shared/note-dock';
import { getNoteWindowTitle, normalizeNoteName } from '../shared/note-name';

export type ManagedNoteWindow = {
  webContentsId: number;
  getBounds: () => NoteBounds;
  onBoundsChanged: (listener: () => void | Promise<void>) => void;
  onClose: (listener: () => void) => void;
  flushPendingChanges: () => Promise<void>;
  show: () => void;
  focus: () => void;
  setTitle: (title: string) => void;
  setCollapsed: (collapsed: boolean) => Promise<void>;
  setDocked: (next: NoteWindowDockTransition) => Promise<void>;
  getPresentation: () => NoteWindowPresentation;
  getDockForPersistence: () => NoteDock | undefined;
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

    note.name = normalizeNoteName(name);
    note.updatedAt = this.now();
    await this.persist();
    this.windowsByNoteId.get(note.id)?.setTitle(getNoteWindowTitle(note.name));

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

  async setCollapsedForWebContents(
    webContentsId: number,
    collapsed: boolean
  ): Promise<boolean> {
    const note = this.getMutableNoteForWebContents(webContentsId);

    if (!note) {
      return false;
    }

    const noteWindow = this.windowsByNoteId.get(note.id);
    await noteWindow?.setCollapsed(collapsed);

    // 防呆：收起/展开命令真正生效后，窗口不应还处于贴边；若 note 上残留
    // dock（例如窗口未能按贴边恢复），一并清掉，避免脏数据留到下次启动。
    if (note.dock && noteWindow?.getPresentation() !== 'docked') {
      delete note.dock;
      note.updatedAt = this.now();
      await this.persist();
    }

    return true;
  }

  async dockNoteForWebContents(
    webContentsId: number,
    input: { side: 'left' | 'right'; y: number; workArea: DisplayWorkArea }
  ): Promise<boolean> {
    const note = this.getMutableNoteForWebContents(webContentsId);

    if (!note) {
      return false;
    }

    const noteWindow = this.windowsByNoteId.get(note.id);

    if (!noteWindow) {
      return false;
    }

    const y = offsetDockYToAvoidOverlap({
      y: input.y,
      side: input.side,
      workArea: input.workArea,
      occupied: this.getDockedSliversExcept(note.id)
    });

    await noteWindow.setDocked({ kind: 'dock', side: input.side, y });

    const persistedDock = noteWindow.getDockForPersistence();

    if (!persistedDock) {
      return false;
    }

    note.dock = persistedDock;
    note.updatedAt = this.now();
    await this.persist();

    return true;
  }

  async undockNoteForWebContents(
    webContentsId: number,
    bounds: Required<NoteBounds>
  ): Promise<boolean> {
    const note = this.getMutableNoteForWebContents(webContentsId);

    if (!note) {
      return false;
    }

    const noteWindow = this.windowsByNoteId.get(note.id);

    if (!noteWindow) {
      return false;
    }

    await noteWindow.setDocked({ kind: 'expand', bounds });

    if (noteWindow.getPresentation() !== 'expanded') {
      return false;
    }

    delete note.dock;
    note.bounds = { ...bounds };
    note.updatedAt = this.now();
    await this.persist();

    return true;
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

  getNoteById(noteId: string): NoteView | undefined {
    const note = this.notesById.get(noteId);
    return note ? this.toNoteView(note) : undefined;
  }

  getBoundsForWebContents(webContentsId: number): NoteBounds | undefined {
    const noteId = this.noteIdByWebContentsId.get(webContentsId);
    return noteId ? this.windowsByNoteId.get(noteId)?.getBounds() : undefined;
  }

  focusForWebContents(webContentsId: number): void {
    const noteId = this.noteIdByWebContentsId.get(webContentsId);
    const noteWindow = noteId ? this.windowsByNoteId.get(noteId) : undefined;
    if (noteWindow) {
      noteWindow.show();
      noteWindow.focus();
    }
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
    noteWindow.setTitle(getNoteWindowTitle(note.name));
    this.windowsByNoteId.set(note.id, noteWindow);
    this.noteIdByWebContentsId.set(noteWindow.webContentsId, note.id);

    // 主进程在显示器夹不住缝时会按展开态建窗；此时持久化的 dock 已失效，
    // 立即丢弃，避免下次启动再尝试恢复到一个不可见的贴边位置。
    if (note.dock && noteWindow.getPresentation() !== 'docked') {
      delete note.dock;
      note.updatedAt = this.now();
      void this.persist().catch(() => undefined);
    }

    noteWindow.onBoundsChanged(() => {
      return this.updateBoundsForWebContents(
        noteWindow.webContentsId,
        noteWindow.getBounds(),
        noteWindow.getDockForPersistence()
      );
    });
    noteWindow.onClose(() => {
      this.windowsByNoteId.delete(note.id);
      this.noteIdByWebContentsId.delete(noteWindow.webContentsId);
    });

    return noteWindow;
  }

  private getDockedSliversExcept(noteId: string): Array<{ side: 'left' | 'right'; y: number }> {
    const slivers: Array<{ side: 'left' | 'right'; y: number }> = [];

    for (const [id, note] of this.notesById) {
      if (id === noteId) {
        continue;
      }

      const liveDock = this.windowsByNoteId.get(id)?.getDockForPersistence();
      const dock = liveDock ?? note.dock;

      if (dock) {
        slivers.push(dock);
      }
    }

    return slivers;
  }

  private async updateBoundsForWebContents(
    webContentsId: number,
    bounds: NoteBounds,
    dock?: { side: 'left' | 'right'; y: number }
  ): Promise<void> {
    const note = this.getMutableNoteForWebContents(webContentsId);

    if (!note) {
      return;
    }

    note.bounds = bounds;
    // 贴边窗口的磁吸沿边滑动也算 bounds 变化：dock.y 跟随当前位置，
    // bounds 仍只记展开态矩形（getBounds 已保证）。
    if (dock) {
      note.dock = dock;
    }
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
    ...(note.dock ? { dock: { ...note.dock } } : {}),
    checklist: note.checklist.map((item) => ({
      ...item
    })),
    images: note.images.map((image) => ({
      ...image
    }))
  };
}
