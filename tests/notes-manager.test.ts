import { describe, expect, it } from 'vitest';
import type { NoteImageStorage, SaveImageInput } from '../main/image-storage';
import { createDefaultNote, NOTE_COLORS, type NoteRecord } from '../main/note-state';
import {
  type CreateManagedNoteWindow,
  NotesManager,
  type ManagedNoteWindow
} from '../main/notes-manager';
import type {
  NoteWindowDockTransition,
  NoteWindowPresentation
} from '../main/note-window-collapse';
import type { NotesDocument } from '../main/storage';

const DOCK_TEST_WORK_AREA = { x: 0, y: 25, width: 1440, height: 875 };

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
    expect(createdWindows[0].window.titles).toEqual(['悬浮便签']);
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

  it('shows and focuses the note window that owns a webContents id', async () => {
    const createdWindows: CreatedWindow[] = [];
    const note = createDefaultNote({
      id: 'note-1',
      now: '2026-07-05T10:00:00.000Z'
    });
    const manager = new NotesManager({
      storage: {
        load: async () => ({ version: 1, notes: [note] }),
        save: async () => undefined
      },
      createWindow: createWindowFactory(createdWindows)
    });

    await manager.start();
    manager.focusForWebContents(1);

    expect(createdWindows[0].window.showCount).toBe(1);
    expect(createdWindows[0].window.focusCount).toBe(1);
  });

  it('forwards per-window collapse state without persisting it to the note record', async () => {
    const createdWindows: CreatedWindow[] = [];
    const note = createDefaultNote({
      id: 'note-1',
      now: '2026-07-22T10:00:00.000Z'
    });
    const manager = new NotesManager({
      storage: {
        load: async () => ({ version: 1, notes: [note] }),
        save: async () => undefined
      },
      createWindow: createWindowFactory(createdWindows)
    });

    await manager.start();

    await expect(manager.setCollapsedForWebContents(1, true)).resolves.toBe(true);
    await expect(manager.setCollapsedForWebContents(1, false)).resolves.toBe(true);
    await expect(manager.setCollapsedForWebContents(999, true)).resolves.toBe(false);

    expect(createdWindows[0].window.collapsedStates).toEqual([true, false]);
    expect(note).not.toHaveProperty('collapsed');
  });

  it('does not acknowledge collapse before the native window operation finishes', async () => {
    const createdWindows: CreatedWindow[] = [];
    let finishCollapse: (() => void) | undefined;
    const collapseFinished = new Promise<void>((resolve) => {
      finishCollapse = resolve;
    });
    const manager = new NotesManager({
      storage: {
        load: async () => ({
          version: 1,
          notes: [createDefaultNote({ id: 'note-1' })]
        }),
        save: async () => undefined
      },
      createWindow: createWindowFactory(
        createdWindows,
        async () => undefined,
        async () => collapseFinished
      )
    });

    await manager.start();
    let didAcknowledge = false;
    const collapse = manager.setCollapsedForWebContents(1, true).then((result) => {
      didAcknowledge = true;
      return result;
    });
    await Promise.resolve();

    expect(didAcknowledge).toBe(false);
    finishCollapse?.();
    await expect(collapse).resolves.toBe(true);
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
    expect(createdWindows.map(({ window }) => window.titles)).toEqual([
      ['悬浮便签'],
      ['悬浮便签']
    ]);
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
    expect(createdWindows[0].window.titles).toEqual(['悬浮便签', '工作']);
  });

  it.each([
    ['trims surrounding whitespace', '  工作计划  ', '工作计划'],
    ['saves whitespace-only names as empty', '   ', ''],
    ['keeps names at the sixty-character boundary', 'a'.repeat(60), 'a'.repeat(60)],
    ['truncates names longer than sixty characters', 'a'.repeat(61), 'a'.repeat(60)],
    ['does not split an emoji at the sixty-character boundary', `${'a'.repeat(59)}😀`, `${'a'.repeat(59)}😀`],
    ['counts emoji as one character when truncating', '😀'.repeat(61), '😀'.repeat(60)]
  ])('%s', async (_description, input, expectedName) => {
    const savedDocuments: NotesDocument[] = [];
    const createdWindows: CreatedWindow[] = [];
    const note = createDefaultNote({
      id: 'note-1',
      now: '2026-07-05T10:00:00.000Z'
    });
    const manager = new NotesManager({
      storage: {
        load: async () => ({ version: 1, notes: [note] }),
        save: async (document) => {
          savedDocuments.push(document);
        }
      },
      createWindow: createWindowFactory(createdWindows),
      now: () => '2026-07-05T10:02:00.000Z'
    });

    await manager.start();
    const result = await manager.updateNameForWebContents(1, input);

    expect(result?.name).toBe(expectedName);
    expect(savedDocuments.at(-1)?.notes[0]?.name).toBe(expectedName);
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

  it('docks a collapsed note window and persists the dock without touching bounds', async () => {
    const savedDocuments: NotesDocument[] = [];
    const createdWindows: CreatedWindow[] = [];
    const note = createDefaultNote({
      id: 'note-1',
      now: '2026-08-14T10:00:00.000Z'
    });
    note.bounds = { x: 200, y: 140, width: 360, height: 280 };
    const manager = new NotesManager({
      storage: {
        load: async () => ({ version: 1, notes: [note] }),
        save: async (document) => {
          savedDocuments.push(document);
        }
      },
      createWindow: createWindowFactory(createdWindows),
      now: () => '2026-08-14T10:01:00.000Z'
    });

    await manager.start();
    await manager.setCollapsedForWebContents(1, true);

    await expect(
      manager.dockNoteForWebContents(1, { side: 'left', y: 100, workArea: DOCK_TEST_WORK_AREA })
    ).resolves.toBe(true);

    expect(createdWindows[0].window.dockTransitions).toEqual([
      { kind: 'dock', side: 'left', y: 100 }
    ]);
    expect(savedDocuments).toEqual([
      {
        version: 1,
        notes: [
          {
            ...note,
            dock: { side: 'left', y: 100 },
            updatedAt: '2026-08-14T10:01:00.000Z'
          }
        ]
      }
    ]);
    expect(savedDocuments[0].notes[0].bounds).toEqual({
      x: 200,
      y: 140,
      width: 360,
      height: 280
    });
  });

  it('offsets a new bookmark tab below an existing one docked on the same side', async () => {
    const savedDocuments: NotesDocument[] = [];
    const createdWindows: CreatedWindow[] = [];
    const firstNote = createDefaultNote({
      id: 'note-1',
      now: '2026-08-14T10:00:00.000Z'
    });
    const secondNote = createDefaultNote({
      id: 'note-2',
      now: '2026-08-14T10:00:30.000Z'
    });
    secondNote.dock = { side: 'left', y: 100 };
    const manager = new NotesManager({
      storage: {
        load: async () => ({ version: 1, notes: [firstNote, secondNote] }),
        save: async (document) => {
          savedDocuments.push(document);
        }
      },
      createWindow: createWindowFactory(createdWindows)
    });

    await manager.start();
    await manager.setCollapsedForWebContents(1, true);
    await manager.dockNoteForWebContents(1, {
      side: 'left',
      y: 100,
      workArea: DOCK_TEST_WORK_AREA
    });

    expect(createdWindows[0].window.dockTransitions).toEqual([
      { kind: 'dock', side: 'left', y: 100 + 32 + 8 }
    ]);
    expect(savedDocuments.at(-1)?.notes[0]?.dock).toEqual({ side: 'left', y: 140 });
    expect(savedDocuments.at(-1)?.notes[1]?.dock).toEqual({ side: 'left', y: 100 });
  });

  it('expands a docked note, clears the dock and stores the expanded bounds', async () => {
    const savedDocuments: NotesDocument[] = [];
    const createdWindows: CreatedWindow[] = [];
    const note = createDefaultNote({
      id: 'note-1',
      now: '2026-08-14T10:00:00.000Z'
    });
    note.dock = { side: 'left', y: 100 };
    const manager = new NotesManager({
      storage: {
        load: async () => ({ version: 1, notes: [note] }),
        save: async (document) => {
          savedDocuments.push(document);
        }
      },
      createWindow: createWindowFactory(createdWindows),
      now: () => '2026-08-14T10:02:00.000Z'
    });

    await manager.start();

    await expect(
      manager.undockNoteForWebContents(1, { x: 48, y: 100, width: 280, height: 220 })
    ).resolves.toBe(true);

    expect(createdWindows[0].window.dockTransitions).toEqual([
      { kind: 'expand', bounds: { x: 48, y: 100, width: 280, height: 220 } }
    ]);
    expect(savedDocuments).toEqual([
      {
        version: 1,
        notes: [
          {
            ...note,
            bounds: { x: 48, y: 100, width: 280, height: 220 },
            updatedAt: '2026-08-14T10:02:00.000Z'
          }
        ]
      }
    ]);
    expect(savedDocuments[0].notes[0]).not.toHaveProperty('dock');
  });

  it('snaps a docked note back without persisting anything', async () => {
    const savedDocuments: NotesDocument[] = [];
    const createdWindows: CreatedWindow[] = [];
    const note = createDefaultNote({
      id: 'note-1',
      now: '2026-08-14T10:00:00.000Z'
    });
    note.dock = { side: 'right', y: 100 };
    const manager = new NotesManager({
      storage: {
        load: async () => ({ version: 1, notes: [note] }),
        save: async (document) => {
          savedDocuments.push(document);
        }
      },
      createWindow: createWindowFactory(createdWindows)
    });

    await manager.start();

    await expect(manager.snapBackDockForWebContents(1)).resolves.toBe(true);

    expect(createdWindows[0].window.dockTransitions).toEqual([{ kind: 'snap-back' }]);
    expect(savedDocuments).toEqual([]);
    expect(manager.getNoteById('note-1')?.dock).toEqual({ side: 'right', y: 100 });
  });

  it('restores a persisted dock as a docked window on start', async () => {
    const createdWindows: CreatedWindow[] = [];
    const note = createDefaultNote({
      id: 'note-1',
      now: '2026-08-14T10:00:00.000Z'
    });
    note.dock = { side: 'left', y: 100 };
    const manager = new NotesManager({
      storage: {
        load: async () => ({ version: 1, notes: [note] }),
        save: async () => undefined
      },
      createWindow: createWindowFactory(createdWindows)
    });

    await manager.start();

    expect(createdWindows[0].window.presentation).toBe('docked');
    expect(manager.getNoteById('note-1')?.dock).toEqual({ side: 'left', y: 100 });
  });

  it('drops a persisted dock when the window could not be restored docked', async () => {
    const savedDocuments: NotesDocument[] = [];
    const createdWindows: CreatedWindow[] = [];
    const note = createDefaultNote({
      id: 'note-1',
      now: '2026-08-14T10:00:00.000Z'
    });
    note.dock = { side: 'left', y: 100 };
    const manager = new NotesManager({
      storage: {
        load: async () => ({ version: 1, notes: [note] }),
        save: async (document) => {
          savedDocuments.push(document);
        }
      },
      createWindow: createWindowFactory(createdWindows, undefined, undefined, {
        restoreDockedWindows: false
      }),
      now: () => '2026-08-14T10:03:00.000Z'
    });

    await manager.start();

    expect(createdWindows[0].window.presentation).toBe('expanded');
    expect(savedDocuments).toEqual([
      {
        version: 1,
        notes: [
          {
            ...note,
            updatedAt: '2026-08-14T10:03:00.000Z'
          }
        ]
      }
    ]);
    expect(savedDocuments[0].notes[0]).not.toHaveProperty('dock');
  });

  it('keeps the dock and expanded bounds when a docked window reports native moves', async () => {
    const savedDocuments: NotesDocument[] = [];
    const createdWindows: CreatedWindow[] = [];
    const note = createDefaultNote({
      id: 'note-1',
      now: '2026-08-14T10:00:00.000Z'
    });
    note.dock = { side: 'left', y: 100 };
    const manager = new NotesManager({
      storage: {
        load: async () => ({ version: 1, notes: [note] }),
        save: async (document) => {
          savedDocuments.push(document);
        }
      },
      createWindow: createWindowFactory(createdWindows),
      now: () => '2026-08-14T10:04:00.000Z'
    });

    await manager.start();
    // 主进程接线里 getBounds 返回的是持久化口径(展开矩形)，贴边拖动不会改写 bounds。
    createdWindows[0].window.bounds = { x: 120, y: 80, width: 280, height: 220 };
    await createdWindows[0].window.triggerBoundsChanged();

    expect(savedDocuments.at(-1)?.notes[0]?.bounds).toEqual({
      x: 120,
      y: 80,
      width: 280,
      height: 220
    });
    expect(savedDocuments.at(-1)?.notes[0]?.dock).toEqual({ side: 'left', y: 100 });
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
  focusCount: number;
  titles: string[];
  collapsedStates: boolean[];
  dockTransitions: NoteWindowDockTransition[];
  presentation: NoteWindowPresentation;
  dock: NoteRecord['dock'];
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
  flushPendingChanges: () => Promise<void> = async () => undefined,
  applyCollapsed: (collapsed: boolean) => Promise<void> = async () => undefined,
  options: { restoreDockedWindows?: boolean } = {}
): CreateManagedNoteWindow {
  let nextWebContentsId = 1;

  return (note) => {
    let boundsChangedListener: (() => void | Promise<void>) | undefined;
    let closeListener: (() => void) | undefined;
    const restoreDocked = options.restoreDockedWindows !== false && note.dock !== undefined;
    const window: TestWindow = {
      webContentsId: nextWebContentsId,
      bounds: note.bounds,
      closed: false,
      flushCount: 0,
      showCount: 0,
      focusCount: 0,
      titles: [],
      collapsedStates: [],
      dockTransitions: [],
      presentation: restoreDocked ? 'docked' : 'expanded',
      dock: restoreDocked && note.dock ? { ...note.dock } : undefined,
      getBounds: () => window.bounds,
      getPresentation: () => window.presentation,
      getDockForPersistence: () => (window.dock ? { ...window.dock } : undefined),
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
      focus: () => {
        window.focusCount += 1;
      },
      setTitle: (title) => {
        window.titles.push(title);
      },
      setCollapsed: async (collapsed) => {
        window.collapsedStates.push(collapsed);
        await applyCollapsed(collapsed);
        if (collapsed && window.presentation === 'expanded') {
          window.presentation = 'collapsed';
        } else if (!collapsed && window.presentation === 'collapsed') {
          window.presentation = 'expanded';
        }
      },
      setDocked: async (next) => {
        window.dockTransitions.push(next);
        if (next.kind === 'dock') {
          if (window.presentation !== 'collapsed') {
            return;
          }
          window.presentation = 'docked';
          window.dock = { side: next.side, y: next.y };
          return;
        }
        if (next.kind === 'expand') {
          if (window.presentation !== 'docked') {
            return;
          }
          window.presentation = 'expanded';
          window.dock = undefined;
          window.bounds = { ...next.bounds };
        }
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
