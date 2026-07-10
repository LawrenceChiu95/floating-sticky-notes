import { describe, expect, it } from 'vitest';
import { normalizeSaveImageInput } from '../main/image-input';

describe('normalizeSaveImageInput', () => {
  it('accepts image bytes with positive dimensions', () => {
    const bytes = new Uint8Array([1, 2, 3]);

    expect(
      normalizeSaveImageInput({
        data: bytes,
        width: 320,
        height: 180
      })
    ).toEqual({
      data: bytes,
      width: 320,
      height: 180
    });
  });

  it('rejects malformed image input', () => {
    expect(
      normalizeSaveImageInput({
        data: 'not bytes',
        width: 320,
        height: 180
      })
    ).toBeUndefined();
    expect(
      normalizeSaveImageInput({
        data: new Uint8Array([1]),
        width: 0,
        height: 180
      })
    ).toBeUndefined();
  });
});
