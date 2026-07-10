import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalImageStorage } from '../main/image-storage';

describe('LocalImageStorage', () => {
  it('saves pasted image bytes under user data images and returns a displayable reference', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'floating-notes-images-'));
    const storage = new LocalImageStorage(join(dir, 'images'), {
      createId: () => 'image-1',
      now: () => '2026-07-05T11:00:00.000Z'
    });
    const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

    const image = await storage.saveImage({
      data: imageBytes,
      width: 320,
      height: 180
    });

    expect(image).toEqual({
      id: 'image-1',
      filename: 'image-1.png',
      width: 320,
      height: 180,
      createdAt: '2026-07-05T11:00:00.000Z'
    });
    await expect(readFile(join(dir, 'images', 'image-1.png'))).resolves.toEqual(imageBytes);
    expect(storage.getImageSource(image)).toBe('sticky-notes-image://local/image-1.png');
  });

  it('serves saved images through the app image protocol only for safe filenames', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'floating-notes-images-'));
    const storage = new LocalImageStorage(join(dir, 'images'), {
      createId: () => 'image-1',
      now: () => '2026-07-05T11:00:00.000Z'
    });
    const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const image = await storage.saveImage({
      data: imageBytes,
      width: 320,
      height: 180
    });

    const response = await storage.createImageResponse(storage.getImageSource(image));
    const unsafeResponse = await storage.createImageResponse(
      'sticky-notes-image://local/..%2Fsecret.png'
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(imageBytes);
    expect(unsafeResponse.status).toBe(404);
  });

  it('deletes saved image files and ignores missing files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'floating-notes-images-'));
    const storage = new LocalImageStorage(join(dir, 'images'), {
      createId: () => 'image-1',
      now: () => '2026-07-05T11:00:00.000Z'
    });
    const image = await storage.saveImage({
      data: Buffer.from([1, 2, 3]),
      width: 32,
      height: 18
    });

    await storage.deleteImage(image);
    await storage.deleteImage(image);

    await expect(readFile(join(dir, 'images', 'image-1.png'))).rejects.toMatchObject({
      code: 'ENOENT'
    });
  });
});
