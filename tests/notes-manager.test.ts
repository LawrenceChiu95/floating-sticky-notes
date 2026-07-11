import { describe, expect, it } from 'vitest';
import type { NoteImageStorage, SaveImageInput } from '../main/image-storage';
import { createDefaultNote, NOTE_COLORS, type NoteRecord } from '../main/note-state';
import { type CreateManagedNoteWindow, NotesManager, type ManagedNoteWindow } from '../main/notes-manager';
import type { NotesDocument } from '../main/storage';

describe('NotesManager', () => {
  it('creates and saves one default note window on first run', async () => {
    const savedDocuments: NotesDocument[] = [];
    const createdWindows: CreatedWindow[] = [];
    const manager = new NotesManager({
      storage: {
        load: async () => ({
          version: 1,
          notes: []
        }),
        save: async (document) => {
          savedDocuments.push(document);
        }
      },
      createWindow: createWindowFactory(createdWindows),
      createId: () => 'note-1',
      now: () => '2026-07-05T10:00:00.000Z'
    });

    await manager.start();

    const defaultNote = createDefaultNote({
      id: 'note-1',
      now: '2026-07-05T10:00:00.000Z'
    });
    expect(createdWindows.map(({ note }) => note)).toEqual([defaultNote]);
    expect(savedDocuments).toEqual([
      {
        version: 1,
        notes: [defaultNote]
      }
    ]);
  });

  it('restores every saved note without overwriting storage on start', async () => {
    const savedDocuments: NotesDocument[] = [];
    const createdWindows: CreatedWindow[] = [];
    const firstNote = createDefaultNote({
      id: 'note-1',
      now: '2026-07-05T10:00:00.000Z'
    });
    const secondNote = createDefaultNote({
      id: 'note-2',
      now: '2026-07-05T10:01:00.000Z'
    });
    const manager = new NotesManager({
      storage: {
        load: async () => ({
          version: 1,
          notes: [firstNote, secondNote]
        }),
        save: async (document) => {
          savedDocuments.push(document);
        }
      },
      createWindow: createWindowFactory(createdWindows)
    });

    await manager.start();

    expect(createdWindows.map(({ note }) => note.id)).toEqual(['note-1', 'note-2']);
    expect(savedDocuments).toEqual([]);
  });

  it('recreates only note windows that the user has closed', async () => {
    const createdWindows: CreatedWindow[] = [];
    const notes = ['note-1', 'note-2'].map((id) =>
      createDefaultNote({ id, now: '2026-07-05T10:00:00.000Z' })
    );
    const manager = new NotesManager({
      storage: {
        load: async () => ({ version: 1, notes }),
        save: async () => undefined
      },
      createWindow: createWindowFactory(createdWindows)
    });

    await manager.start();
    createdWindows[0].window.triggerClosed();

    expect(manager.restoreClosedNotes()).toBe(1);
    expect(createdWindows.map(({ note }) => note.id)).toEqual([
      'note-1',
      'note-2',
      'note-1'
    ]);
    expect(createdWindows[1].window.showCount).toBe(1);
    expect(manager.restoreClosedNotes()).toBe(0);
    expect(createdWindows[1].window.showCount).toBe(2);
    expect(createdWindows[2].window.showCount).toBe(1);
  });

  it('creates, windows, and saves a new note below the note limit', async () => {
    const savedDocuments: NotesDocument[] = [];
    const createdWindows: CreatedWindow[] = [];
    const existingNote = createDefaultNote({
      id: 'note-1',
      now: '2026-07-05T10:00:00.000Z'
    });
    const manager = new NotesManager({
      storage: {
        load: async () => ({
          version: 1,
          notes: [existingNote]
        }),
        save: async (document) => {
          savedDocuments.push(document);
        }
      },
      createWindow: createWindowFactory(createdWindows),
      createId: () => 'note-2',
      now: () => '2026-07-05T10:01:00.000Z'
    });

    await manager.start();
    const result = await manager.createNote();

    const newNote = createDefaultNote({
      id: 'note-2',
      now: '2026-07-05T10:01:00.000Z'
    });
    expect(result).toEqual({
      ok: true,
      note: newNote
    });
    expect(createdWindows.map(({ note }) => note.id)).toEqual(['note-1', 'note-2']);
    expect(savedDocuments).toEqual([
      {
        version: 1,
        notes: [existingNote, newNote]
      }
    ]);
  });

  it('refuses to create more than twenty notes', async () => {
    const savedDocuments: NotesDocument[] = [];
    const createdWindows: CreatedWindow[] = [];
    const notes = Array.from({ length: 20 }, (_, index) =>
      createDefaultNote({
        id: `note-${index + 1}`,
        now: '2026-07-05T10:00:00.000Z'
      })
    );
    const manager = new NotesManager({
      storage: {
        load: async () => ({
          version: 1,
          notes
        }),
        save: async (document) => {
          savedDocuments.push(document);
        }
      },
      createWindow: createWindowFactory(createdWindows),
      createId: () => 'note-21',
      now: () => '2026-07-05T10:01:00.000Z'
    });

    await manager.start();
    const result = await manager.createNote();

    expect(result).toEqual({
      ok: false,
      reason: 'max-notes'
    });
    expect(createdWindows).toHaveLength(20);
    expect(savedDocuments).toEqual([]);
  });

  it('restores at most twenty windows from storage', async () => {
    const savedDocuments: NotesDocument[] = [];
    const createdWindows: CreatedWindow[] = [];
    const notes = Array.from({ length: 21 }, (_, index) =>
      createDefaultNote({
        id: `note-${index + 1}`,
        now: '2026-07-05T10:00:00.000Z'
      })
    );
    const manager = new NotesManager({
      storage: {
        load: async () => ({
          version: 1,
          notes
        }),
        save: async (document) => {
          savedDocuments.push(document);
        }
      },
      createWindow: createWindowFactory(createdWindows)
    });

    await manager.start();

    expect(createdWindows.map(({ note }) => note.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => `note-${index + 1}`)
    );
    expect(savedDocuments).toEqual([
      {
        version: 1,
        notes: notes.slice(0, 20)
      }
    ]);
  });

  it('saves content edits for the window that sent them', async () => {
    const savedDocuments: NotesDocument[] = [];
    const createdWindows: CreatedWindow[] = [];
    const note = createDefaultNote({
      id: 'note-1',
      now: '2026-07-05T10:00:00.000Z'
    });
    const manager = new NotesManager({
      storage: {
        load: async () => ({
          version: 1,
          notes: [note]
        }),
        save: async (document) => {
          savedDocuments.push(document);
        }
      },
      createWindow: createWindowFactory(createdWindows),
      now: () => '2026-07-05T10:02:00.000Z'
    });

    await manager.start();
    await manager.updateContentForWebContents(1, '窗口 1 的内容');

    expect(savedDocuments).toEqual([
      {
        version: 1,
        notes: [
          {
            ...note,
            content: '窗口 1 的内容',
            updatedAt: '2026-07-05T10:02:00.000Z'
          }
        ]
      }
    ]);
  });

  it('saves note name edits for the window that sent them', async () => {
    const savedDocuments: NotesDocument[] = [];
    const createdWindows: CreatedWindow[] = [];
    const note = createDefaultNote({
      id: 'note-1',
      now: '2026-07-05T10:00:00.000Z'
    });
    const manager = new NotesManager({
      storage: {
        load: async () => ({
          version: 1,
          notes: [note]
        }),
        save: async (document) => {
          savedDocuments.push(document);
        }
      },
      createWindow: createWindowFactory(createdWindows),
      now: () => '2026-07-05T10:02:00.000Z'
    });

    await manager.start();
    const result = await manager.updateNameForWebContents(1, '工作');

    expect(result).toEqual({
      ...note,
      name: '工作',
      updatedAt: '2026-07-05T10:02:00.000Z'
    });
    expect(savedDocuments).toEqual([
      {
        version: 1,
        notes: [
          {
            ...note,
            name: '工作',
            updatedAt: '2026-07-05T10:02:00.000Z'
          }
        ]
      }
    ]);
  });

  it('serializes overlapping content saves so the latest edit wins', async () => {
    const savedContents: string[] = [];
    let releaseFirstSave: (() => void) | undefined;
    const firstSaveCanFinish = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });
    const createdWindows: CreatedWindow[] = [];
    const note = createDefaultNote({
      id: 'note-1',
      now: '2026-07-05T10:00:00.000Z'
    });
    const manager = new NotesManager({
      storage: {
        load: async () => ({
          version: 1,
          notes: [note]
        }),
        save: async (document) => {
          const savedContent = document.notes[0]?.content ?? '';

          if (savedContent === 'first') {
            await firstSaveCanFinish;
          }

          savedContents.push(savedContent);
        }
      },
      createWindow: createWindowFactory(createdWindows),
      now: () => '2026-07-05T10:02:00.000Z'
    });

    await manager.start();
    const firstSave = manager.updateContentForWebContents(1, 'first');
    const secondSave = manager.updateContentForWebContents(1, 'second');
    await Promise.resolve();

    expect(savedContents).toEqual([]);

    releaseFirstSave?.();
    await Promise.all([firstSave, secondSave]);

    expect(savedContents).toEqual(['first', 'second']);
  });

  it('saves moved and resized bounds from each note window', async () => {
    const savedDocuments: NotesDocument[] = [];
    const createdWindows: CreatedWindow[] = [];
    const note = createDefaultNote({
      id: 'note-1',
      now: '2026-07-05T10:00:00.000Z'
    });
    const manager = new NotesManager({
      storage: {
        load: async () => ({
          version: 1,
          notes: [note]
        }),
        save: async (document) => {
          savedDocuments.push(document);
        }
      },
      createWindow: createWindowFactory(createdWindows),
      now: () => '2026-07-05T10:03:00.000Z'
    });

    await manager.start();
    createdWindows[0].window.bounds = {
      x: 200,
      y: 140,
      width: 360,
      height: 280
    };
    await createdWindows[0].window.triggerBoundsChanged();

    expect(savedDocuments).toEqual([
      {
        version: 1,
        notes: [
          {
            ...note,
            bounds: {
              x: 200,
              y: 140,
              width: 360,
              height: 280
            },
            updatedAt: '2026-07-05T10:03:00.000Z'
          }
        ]
      }
    ]);
  });

  it('saves checklist edits for the window that sent them', async () => {
    const savedDocuments: NotesDocument[] = [];
    const createdWindows: CreatedWindow[] = [];
    const note = createDefaultNote({
      id: 'note-1',
      now: '2026-07-05T10:00:00.000Z'
    });
    const checklist = [
      {
        id: 'item-1',
        text: '拖拽图片回归',
        checked: true,
        createdAt: '2026-07-05T10:05:00.000Z',
        updatedAt: '2026-07-05T10:06:00.000Z'
      }
    ];
    const manager = new NotesManager({
      storage: {
        load: async () => ({
          version: 1,
          notes: [note]
        }),
        save: async (document) => {
          savedDocuments.push(document);
        }
      },
      createWindow: createWindowFactory(createdWindows),
      now: () => '2026-07-05T10:07:00.000Z'
    });

    await manager.start();
    const result = await manager.updateChecklistForWebContents(1, checklist);

    expect(result).toEqual({
      ...note,
      checklist,
      updatedAt: '2026-07-05T10:07:00.000Z'
    });
    expect(savedDocuments).toEqual([
      {
        version: 1,
        notes: [
          {
            ...note,
            checklist,
            updatedAt: '2026-07-05T10:07:00.000Z'
          }
        ]
      }
    ]);
  });

  it('saves note color and clamps opacity for the window that sent them', async () => {
    const savedDocuments: NotesDocument[] = [];
    const createdWindows: CreatedWindow[] = [];
    const note = createDefaultNote({
      id: 'note-1',
      now: '2026-07-05T10:00:00.000Z'
    });
    const manager = new NotesManager({
      storage: {
        load: async () => ({
          version: 1,
          notes: [note]
        }),
        save: async (document) => {
          savedDocuments.push(document);
        }
      },
      createWindow: createWindowFactory(createdWindows),
      now: () => '2026-07-05T10:08:00.000Z'
    });

    await manager.start();
    const result = await manager.updateAppearanceForWebContents(1, {
      color: NOTE_COLORS.softBlue,
      opacity: 0.2
    });

    expect(result).toEqual({
      ...note,
      color: NOTE_COLORS.softBlue,
      opacity: 0.3,
      updatedAt: '2026-07-05T10:08:00.000Z'
    });
    expect(savedDocuments).toEqual([
      {
        version: 1,
        notes: [
          {
            ...note,
            color: NOTE_COLORS.softBlue,
            opacity: 0.3,
            updatedAt: '2026-07-05T10:08:00.000Z'
          }
        ]
      }
    ]);
  });

  it('ignores invalid appearance edits', async () => {
    const savedDocuments: NotesDocument[] = [];
    const createdWindows: CreatedWindow[] = [];
    const note = createDefaultNote({
      id: 'note-1',
      now: '2026-07-05T10:00:00.000Z'
    });
    const manager = new NotesManager({
      storage: {
        load: async () => ({
          version: 1,
          notes: [note]
        }),
        save: async (document) => {
          savedDocuments.push(document);
        }
      },
      createWindow: createWindowFactory(createdWindows)
    });

    await manager.start();
    const result = await manager.updateAppearanceForWebContents(1, {
      color: '#7C3AED',
      opacity: Number.NaN
    });

    expect(result).toBeUndefined();
    expect(savedDocuments).toEqual([]);
  });

  it('attaches a pasted image to the note that owns the current window', async () => {
    const savedDocuments: NotesDocument[] = [];
    const savedImages: SaveImageInput[] = [];
    const createdWindows: CreatedWindow[] = [];
    const note = createDefaultNote({
      id: 'note-1',
      now: '2026-07-05T10:00:00.000Z'
    });
    const imageStorage: NoteImageStorage = {
      saveImage: async (input) => {
        savedImages.push(input);
        return {
          id: 'image-1',
          filename: 'image-1.png',
          width: input.width,
          height: input.height,
          createdAt: '2026-07-05T11:00:00.000Z'
        };
      },
      getImageSource: (image) => `sticky-notes-image://local/${image.filename}`,
      deleteImage: async () => undefined
    };
    const manager = new NotesManager({
      storage: {
        load: async () => ({
          version: 1,
          notes: [note]
        }),
        save: async (document) => {
          savedDocuments.push(document);
        }
      },
      createWindow: createWindowFactory(createdWindows),
      imageStorage,
      now: () => '2026-07-05T11:01:00.000Z'
    });
    const imageBytes = Buffer.from([1, 2, 3]);

    await manager.start();
    const result = await manager.addImageForWebContents(1, {
      data: imageBytes,
      width: 320,
      height: 180
    });

    const storedImage = {
      id: 'image-1',
      filename: 'image-1.png',
      width: 320,
      height: 180,
      createdAt: '2026-07-05T11:00:00.000Z'
    };
    expect(savedImages).toEqual([
      {
        data: imageBytes,
        width: 320,
        height: 180
      }
    ]);
    expect(result).toEqual({
      ok: true,
      note: {
        ...note,
        images: [
          {
            ...storedImage,
            src: 'sticky-notes-image://local/image-1.png'
          }
        ],
        updatedAt: '2026-07-05T11:01:00.000Z'
      }
    });
    expect(savedDocuments).toEqual([
      {
        version: 1,
        notes: [
          {
            ...note,
            images: [storedImage],
            updatedAt: '2026-07-05T11:01:00.000Z'
          }
        ]
      }
    ]);
  });

  it('removes one image from the current note and deletes the unused file after saving', async () => {
    const savedDocuments: NotesDocument[] = [];
    const deletedImages: string[] = [];
    const createdWindows: CreatedWindow[] = [];
    const note = createDefaultNote({
      id: 'note-1',
      now: '2026-07-05T10:00:00.000Z'
    });
    const firstImage = createImageRecord('image-1');
    const secondImage = createImageRecord('image-2');
    note.images = [firstImage, secondImage];
    const manager = new NotesManager({
      storage: {
        load: async () => ({
          version: 1,
          notes: [note]
        }),
        save: async (document) => {
          savedDocuments.push(document);
        }
      },
      createWindow: createWindowFactory(createdWindows),
      imageStorage: createTestImageStorage(deletedImages),
      now: () => '2026-07-05T11:02:00.000Z'
    });

    await manager.start();
    const result = await manager.deleteImageForWebContents(1, 'image-1');

    expect(result).toEqual({
      ok: true,
      note: {
        ...note,
        images: [
          {
            ...secondImage,
            src: 'sticky-notes-image://local/image-2.png'
          }
        ],
        updatedAt: '2026-07-05T11:02:00.000Z'
      }
    });
    expect(savedDocuments).toEqual([
      {
        version: 1,
        notes: [
          {
            ...note,
            images: [secondImage],
            updatedAt: '2026-07-05T11:02:00.000Z'
          }
        ]
      }
    ]);
    expect(deletedImages).toEqual(['image-1.png']);
  });

  it('keeps an image file when another note still references it', async () => {
    const savedDocuments: NotesDocument[] = [];
    const deletedImages: string[] = [];
    const createdWindows: CreatedWindow[] = [];
    const sharedImage = createImageRecord('image-shared');
    const firstNote = createDefaultNote({
      id: 'note-1',
      now: '2026-07-05T10:00:00.000Z'
    });
    const secondNote = createDefaultNote({
      id: 'note-2',
      now: '2026-07-05T10:01:00.000Z'
    });
    firstNote.images = [sharedImage];
    secondNote.images = [sharedImage];
    const manager = new NotesManager({
      storage: {
        load: async () => ({
          version: 1,
          notes: [firstNote, secondNote]
        }),
        save: async (document) => {
          savedDocuments.push(document);
        }
      },
      createWindow: createWindowFactory(createdWindows),
      imageStorage: createTestImageStorage(deletedImages),
      now: () => '2026-07-05T11:03:00.000Z'
    });

    await manager.start();
    await manager.deleteImageForWebContents(1, 'image-shared');

    expect(savedDocuments.at(-1)).toEqual({
      version: 1,
      notes: [
        {
          ...firstNote,
          images: [],
          updatedAt: '2026-07-05T11:03:00.000Z'
        },
        secondNote
      ]
    });
    expect(deletedImages).toEqual([]);
  });

  it('cleans up images that become unused when deleting a note', async () => {
    const savedDocuments: NotesDocument[] = [];
    const deletedImages: string[] = [];
    const createdWindows: CreatedWindow[] = [];
    const firstNote = createDefaultNote({
      id: 'note-1',
      now: '2026-07-05T10:00:00.000Z'
    });
    const secondNote = createDefaultNote({
      id: 'note-2',
      now: '2026-07-05T10:01:00.000Z'
    });
    const noteOnlyImage = createImageRecord('image-note-only');
    const sharedImage = createImageRecord('image-shared');
    firstNote.images = [noteOnlyImage, sharedImage];
    secondNote.images = [sharedImage];
    const manager = new NotesManager({
      storage: {
        load: async () => ({
          version: 1,
          notes: [firstNote, secondNote]
        }),
        save: async (document) => {
          savedDocuments.push(document);
        }
      },
      createWindow: createWindowFactory(createdWindows),
      imageStorage: createTestImageStorage(deletedImages)
    });

    await manager.start();
    await manager.deleteNoteForWebContents(1);

    expect(savedDocuments.at(-1)).toEqual({
      version: 1,
      notes: [secondNote]
    });
    expect(deletedImages).toEqual(['image-note-only.png']);
  });

  it('deletes the note belonging to the current window', async () => {
    const savedDocuments: NotesDocument[] = [];
    const createdWindows: CreatedWindow[] = [];
    const note = createDefaultNote({
      id: 'note-1',
      now: '2026-07-05T10:00:00.000Z'
    });
    const manager = new NotesManager({
      storage: {
        load: async () => ({
          version: 1,
          notes: [note]
        }),
        save: async (document) => {
          savedDocuments.push(document);
        }
      },
      createWindow: createWindowFactory(createdWindows)
    });

    await manager.start();
    await manager.deleteNoteForWebContents(1);

    expect(createdWindows[0].window.closed).toBe(true);
    expect(savedDocuments).toEqual([
      {
        version: 1,
        notes: []
      }
    ]);
  });

  it('waits for note windows and queued storage writes to flush', async () => {
    const savedContents: string[] = [];
    let releaseWindowFlush: (() => void) | undefined;
    const windowFlushCanFinish = new Promise<void>((resolve) => {
      releaseWindowFlush = resolve;
    });
    let releaseFirstSave: (() => void) | undefined;
    const firstSaveCanFinish = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });
    const createdWindows: CreatedWindow[] = [];
    const note = createDefaultNote({
      id: 'note-1',
      now: '2026-07-05T10:00:00.000Z'
    });
    const manager = new NotesManager({
      storage: {
        load: async () => ({
          version: 1,
          notes: [note]
        }),
        save: async (document) => {
          const savedContent = document.notes[0]?.content ?? '';

          if (savedContent === 'queued edit') {
            await firstSaveCanFinish;
          }

          savedContents.push(savedContent);
        }
      },
      createWindow: createWindowFactory(createdWindows, () => windowFlushCanFinish),
      now: () => '2026-07-05T10:04:00.000Z'
    });

    await manager.start();
    const queuedSave = manager.updateContentForWebContents(1, 'queued edit');
    const flush = manager.flushPendingSaves();
    await Promise.resolve();

    expect(savedContents).toEqual([]);

    releaseWindowFlush?.();
    releaseFirstSave?.();
    await Promise.all([queuedSave, flush]);

    expect(savedContents).toEqual(['queued edit']);
    expect(createdWindows[0].window.flushCount).toBe(1);
  });
});

type CreatedWindow = {
  note: NoteRecord;
  window: TestWindow;
};

type TestWindow = ManagedNoteWindow & {
  bounds: NoteRecord['bounds'];
  closed: boolean;
  flushCount: number;
  showCount: number;
  triggerBoundsChanged: () => Promise<void>;
  triggerClosed: () => void;
};

function createImageRecord(id: string) {
  return {
    id,
    filename: `${id}.png`,
    width: 320,
    height: 180,
    createdAt: '2026-07-05T11:00:00.000Z'
  };
}

function createTestImageStorage(deletedImages: string[]): NoteImageStorage {
  return {
    saveImage: async (input) => ({
      id: 'image-added',
      filename: 'image-added.png',
      width: input.width,
      height: input.height,
      createdAt: '2026-07-05T11:00:00.000Z'
    }),
    getImageSource: (image) => `sticky-notes-image://local/${image.filename}`,
    deleteImage: async (image) => {
      deletedImages.push(image.filename);
    }
  };
}

function createWindowFactory(
  createdWindows: CreatedWindow[],
  flushPendingChanges: () => Promise<void> = async () => undefined
): CreateManagedNoteWindow {
  let nextWebContentsId = 1;

  return (note) => {
    let boundsChangedListener: (() => void | Promise<void>) | undefined;
    let closeListener: (() => void) | undefined;
    const window: TestWindow = {
      webContentsId: nextWebContentsId,
      bounds: note.bounds,
      closed: false,
      flushCount: 0,
      showCount: 0,
      getBounds: () => window.bounds,
      onBoundsChanged: (listener) => {
        boundsChangedListener = listener;
      },
      onClose: (listener) => {
        closeListener = listener;
      },
      close: () => {
        window.closed = true;
      },
      show: () => {
        window.showCount += 1;
      },
      flushPendingChanges: async () => {
        window.flushCount += 1;
        await flushPendingChanges();
      },
      triggerBoundsChanged: async () => {
        await boundsChangedListener?.();
      },
      triggerClosed: () => {
        closeListener?.();
      }
    };

    nextWebContentsId += 1;
    createdWindows.push({
      note,
      window
    });
    return window;
  };
}
