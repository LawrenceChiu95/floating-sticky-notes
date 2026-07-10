import { describe, expect, it } from 'vitest';
import { isImageDropFile } from '../renderer/src/image-drop';

describe('isImageDropFile', () => {
  it('accepts files with an image MIME type', () => {
    expect(
      isImageDropFile({
        name: 'clipboard-image',
        type: 'image/png'
      })
    ).toBe(true);
  });

  it('accepts Windows Explorer image files with an empty MIME type', () => {
    expect(
      isImageDropFile({
        name: 'screenshot.PNG',
        type: ''
      })
    ).toBe(true);
    expect(
      isImageDropFile({
        name: 'photo.jpeg',
        type: ''
      })
    ).toBe(true);
  });

  it('rejects non-image files with an empty MIME type', () => {
    expect(
      isImageDropFile({
        name: 'notes.txt',
        type: ''
      })
    ).toBe(false);
  });
});
