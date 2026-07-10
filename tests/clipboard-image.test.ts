import { describe, expect, it } from 'vitest';
import { pasteClipboardImage } from '../main/clipboard-image';
import type { SaveImageInput } from '../main/image-storage';

describe('pasteClipboardImage', () => {
  it('returns an empty-clipboard result when the clipboard has no image', async () => {
    const result = await pasteClipboardImage({
      clipboard: {
        readImage: () => ({
          isEmpty: () => true,
          toPNG: () => Buffer.from([]),
          getSize: () => ({ width: 0, height: 0 })
        })
      },
      addImage: async () => {
        throw new Error('should not save when the clipboard is empty');
      }
    });

    expect(result).toEqual({
      ok: false,
      reason: 'empty-clipboard'
    });
  });

  it('saves clipboard image bytes with their display size', async () => {
    const imageBytes = Buffer.from([1, 2, 3]);
    const savedInputs: SaveImageInput[] = [];

    const result = await pasteClipboardImage({
      clipboard: {
        readImage: () => ({
          isEmpty: () => false,
          toPNG: () => imageBytes,
          getSize: () => ({ width: 640, height: 360 })
        })
      },
      addImage: async (input) => {
        savedInputs.push(input);
        return {
          ok: true,
          note: {
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
            images: [
              {
                id: 'image-1',
                filename: 'image-1.png',
                width: 640,
                height: 360,
                createdAt: '2026-07-05T11:00:00.000Z',
                src: 'sticky-notes-image://local/image-1.png'
              }
            ],
            syncStatus: 'local',
            createdAt: '2026-07-05T10:00:00.000Z',
            updatedAt: '2026-07-05T11:01:00.000Z'
          }
        };
      }
    });

    expect(savedInputs).toEqual([
      {
        data: imageBytes,
        width: 640,
        height: 360
      }
    ]);
    expect(result.ok).toBe(true);
  });
});
