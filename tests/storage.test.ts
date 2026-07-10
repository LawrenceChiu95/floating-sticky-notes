import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  createDefaultNote,
  DEFAULT_NOTE_BOUNDS,
  DEFAULT_NOTE_COLOR,
  DEFAULT_NOTE_OPACITY
} from '../main/note-state';
import { JsonNotesStorage } from '../main/storage';

describe('JsonNotesStorage', () => {
  it('loads an empty notes document when the file does not exist yet', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'floating-notes-storage-'));
    const storage = new JsonNotesStorage(join(dir, 'notes.json'));

    await expect(storage.load()).resolves.toEqual({
      version: 1,
      notes: []
    });
  });

  it('saves and loads note name, content, and window bounds', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'floating-notes-storage-'));
    const storage = new JsonNotesStorage(join(dir, 'notes.json'));
    const note = createDefaultNote({
      id: 'note-1',
      now: '2026-07-05T10:00:00.000Z'
    });
    note.name = '工作';
    note.content = '记得补测试';
    note.bounds = {
      x: 120,
      y: 80,
      width: 320,
      height: 260
    };

    await storage.save({
      version: 1,
      notes: [note]
    });

    await expect(storage.load()).resolves.toEqual({
      version: 1,
      notes: [note]
    });
  });

  it('keeps a backup of the previous document before overwriting', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'floating-notes-storage-'));
    const filePath = join(dir, 'notes.json');
    const storage = new JsonNotesStorage(filePath);
    const firstNote = createDefaultNote({
      id: 'note-1',
      now: '2026-07-05T10:00:00.000Z'
    });
    const secondNote = createDefaultNote({
      id: 'note-2',
      now: '2026-07-05T10:01:00.000Z'
    });

    await storage.save({
      version: 1,
      notes: [firstNote]
    });
    await storage.save({
      version: 1,
      notes: [secondNote]
    });

    await expect(readFile(join(dir, 'notes.backup.json'), 'utf8')).resolves.toBe(
      `${JSON.stringify({ version: 1, notes: [firstNote] }, null, 2)}\n`
    );
  });

  it('falls back to the backup when the primary document is corrupt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'floating-notes-storage-'));
    const filePath = join(dir, 'notes.json');
    const backupPath = join(dir, 'notes.backup.json');
    const storage = new JsonNotesStorage(filePath);
    const backupNote = createDefaultNote({
      id: 'note-1',
      now: '2026-07-05T10:00:00.000Z'
    });

    await writeFile(filePath, '{bad json', 'utf8');
    await writeFile(
      backupPath,
      `${JSON.stringify({ version: 1, notes: [backupNote] }, null, 2)}\n`,
      'utf8'
    );

    await expect(storage.load()).resolves.toEqual({
      version: 1,
      notes: [backupNote]
    });
  });

  it('loads an empty document when the primary document is corrupt and no backup exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'floating-notes-storage-'));
    const filePath = join(dir, 'notes.json');
    const storage = new JsonNotesStorage(filePath);

    await writeFile(filePath, '{bad json', 'utf8');

    await expect(storage.load()).resolves.toEqual({
      version: 1,
      notes: []
    });
  });

  it('falls back to backup when the primary document has the wrong shape', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'floating-notes-storage-'));
    const filePath = join(dir, 'notes.json');
    const backupPath = join(dir, 'notes.backup.json');
    const storage = new JsonNotesStorage(filePath);
    const backupNote = createDefaultNote({
      id: 'note-1',
      now: '2026-07-05T10:00:00.000Z'
    });

    await writeFile(filePath, '{"version":1}', 'utf8');
    await writeFile(
      backupPath,
      `${JSON.stringify({ version: 1, notes: [backupNote] }, null, 2)}\n`,
      'utf8'
    );

    await expect(storage.load()).resolves.toEqual({
      version: 1,
      notes: [backupNote]
    });
  });

  it('loads an empty document when the primary and backup documents both cannot be used', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'floating-notes-storage-'));
    const filePath = join(dir, 'notes.json');
    const backupPath = join(dir, 'notes.backup.json');
    const storage = new JsonNotesStorage(filePath);

    await writeFile(filePath, '{"notes":"not an array"}', 'utf8');
    await writeFile(backupPath, '{bad backup json', 'utf8');

    await expect(storage.load()).resolves.toEqual({
      version: 1,
      notes: []
    });
  });

  it('normalizes malformed individual notes without discarding the whole document', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'floating-notes-storage-'));
    const filePath = join(dir, 'notes.json');
    const storage = new JsonNotesStorage(filePath);
    const validNote = createDefaultNote({
      id: 'note-valid',
      now: '2026-07-05T10:00:00.000Z'
    });

    await writeFile(
      filePath,
      `${JSON.stringify(
        {
          version: 1,
          notes: [
            validNote,
            {
              id: 'note-needs-defaults',
              name: 42,
              content: 42,
              bounds: {
                x: 'bad-x',
                y: 80,
                width: 'wide',
                height: 0
              },
              color: 99,
              opacity: 'opaque',
              checklist: [
                {
                  id: 'item-valid',
                  text: '回归 Windows',
                  checked: true,
                  createdAt: '2026-07-05T12:00:00.000Z',
                  updatedAt: '2026-07-05T12:01:00.000Z'
                },
                {
                  id: '',
                  text: 'skip invalid item',
                  checked: false
                },
                {
                  id: 'item-needs-defaults',
                  text: 42,
                  checked: 'yes'
                }
              ],
              images: [
                {
                  id: 'image-valid',
                  filename: 'image-valid.png',
                  width: 120,
                  height: 80,
                  createdAt: '2026-07-05T11:00:00.000Z'
                },
                {
                  id: 'image-bad-path',
                  filename: '../secret.png',
                  width: 120,
                  height: 80
                },
                {
                  id: 'image-bad-dimensions',
                  filename: 'image-bad-dimensions.png',
                  width: 'wide',
                  height: -1
                }
              ],
              syncStatus: 'remote',
              createdAt: null
            },
            {
              id: '',
              content: 'skip invalid id',
              bounds: DEFAULT_NOTE_BOUNDS
            },
            null
          ]
        },
        null,
        2
      )}\n`,
      'utf8'
    );

    await expect(storage.load()).resolves.toEqual({
      version: 1,
      notes: [
        validNote,
        {
          id: 'note-needs-defaults',
          name: '',
          content: '',
          bounds: {
            ...DEFAULT_NOTE_BOUNDS,
            y: 80
          },
          color: DEFAULT_NOTE_COLOR,
          opacity: DEFAULT_NOTE_OPACITY,
          checklist: [
            {
              id: 'item-valid',
              text: '回归 Windows',
              checked: true,
              createdAt: '2026-07-05T12:00:00.000Z',
              updatedAt: '2026-07-05T12:01:00.000Z'
            },
            {
              id: 'item-needs-defaults',
              text: '',
              checked: false,
              createdAt: '',
              updatedAt: ''
            }
          ],
          images: [
            {
              id: 'image-valid',
              filename: 'image-valid.png',
              width: 120,
              height: 80,
              createdAt: '2026-07-05T11:00:00.000Z'
            },
            {
              id: 'image-bad-dimensions',
              filename: 'image-bad-dimensions.png',
              width: 0,
              height: 0,
              createdAt: ''
            }
          ],
          syncStatus: 'local',
          createdAt: '',
          updatedAt: ''
        }
      ]
    });
  });
});
