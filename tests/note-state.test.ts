import { describe, expect, it } from 'vitest';
import { createDefaultNote } from '../main/note-state';

describe('note state', () => {
  it('creates a default note with window state and sync metadata', () => {
    const note = createDefaultNote({
      id: 'note-1',
      now: '2026-07-05T10:00:00.000Z'
    });

    expect(note).toEqual({
      id: 'note-1',
      name: '',
      content: '',
      bounds: {
        width: 280,
        height: 220
      },
      color: '#FFF3B0',
      opacity: 0.94,
      checklist: [],
      images: [],
      syncStatus: 'local',
      createdAt: '2026-07-05T10:00:00.000Z',
      updatedAt: '2026-07-05T10:00:00.000Z'
    });
  });
});
