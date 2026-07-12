import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAC_UPDATE_METADATA_URL,
  createMacUpdateService,
  normalizeMacUpdateMetadata
} from '../main/mac-update-service';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('macOS update metadata', () => {
  it('normalizes electron-builder latest-mac metadata', () => {
    const sha512 = Buffer.alloc(64, 2).toString('base64');

    expect(
      normalizeMacUpdateMetadata({
        version: '0.1.10',
        path: 'StickyNotes-Mac-0.1.10.dmg',
        sha512,
        files: [{ url: 'StickyNotes-Mac-0.1.10.dmg', sha512, size: 123 }]
      })
    ).toEqual({
      version: '0.1.10',
      fileName: 'StickyNotes-Mac-0.1.10.dmg',
      sha512,
      size: 123
    });
  });

  it('rejects unsafe or inconsistent metadata', () => {
    const sha512 = Buffer.alloc(64, 2).toString('base64');
    const base = {
      version: '0.1.10',
      path: 'StickyNotes-Mac-0.1.10.dmg',
      sha512,
      files: [{ url: 'StickyNotes-Mac-0.1.10.dmg', sha512, size: 123 }]
    };

    expect(normalizeMacUpdateMetadata({ ...base, path: '../update.dmg' })).toBeUndefined();
    expect(normalizeMacUpdateMetadata({ ...base, path: 'StickyNotes-Mac-0.1.9.dmg' })).toBeUndefined();
    expect(normalizeMacUpdateMetadata({ ...base, sha512: 'invalid' })).toBeUndefined();
    expect(normalizeMacUpdateMetadata({ ...base, files: [] })).toBeUndefined();
  });
});

describe('macOS update service', () => {
  it('fetches metadata, downloads the DMG, and verifies its bytes and hash', async () => {
    const downloadsPath = await createTempDirectory();
    const bytes = Buffer.from('dmg fixture');
    const sha512 = createHash('sha512').update(bytes).digest('base64');
    const yaml = [
      'version: 0.1.10',
      'path: StickyNotes-Mac-0.1.10.dmg',
      `sha512: ${sha512}`,
      'files:',
      '  - url: StickyNotes-Mac-0.1.10.dmg',
      `    sha512: ${sha512}`,
      `    size: ${bytes.length}`
    ].join('\n');
    const fetch = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(yaml, { status: 200 }))
      .mockResolvedValueOnce(new Response(bytes, { status: 200 }));
    const openPath = vi.fn(async () => '');
    const service = createMacUpdateService({ downloadsPath, fetch, openPath });

    const update = await service.getLatest();
    const progress: number[] = [];
    const filePath = await service.download(update, (value) => progress.push(value));
    await service.openInstaller(filePath);

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      MAC_UPDATE_METADATA_URL,
      expect.objectContaining({ cache: 'no-store' })
    );
    expect(await readFile(filePath)).toEqual(bytes);
    expect(progress).toContain(1);
    expect(openPath).toHaveBeenCalledWith(filePath);
  });

  it('removes an invalid download and reports a checksum mismatch', async () => {
    const downloadsPath = await createTempDirectory();
    const expectedBytes = Buffer.from('expected');
    const actualBytes = Buffer.from('tampered');
    const update = {
      version: '0.1.10',
      fileName: 'StickyNotes-Mac-0.1.10.dmg',
      sha512: createHash('sha512').update(expectedBytes).digest('base64'),
      size: actualBytes.length
    };
    const fetch = vi.fn(async () => new Response(actualBytes, { status: 200 }));
    const service = createMacUpdateService({
      downloadsPath,
      fetch,
      openPath: vi.fn(async () => '')
    });

    await expect(service.download(update, () => undefined)).rejects.toThrow('校验失败');
    await expect(readFile(join(downloadsPath, update.fileName))).rejects.toMatchObject({
      code: 'ENOENT'
    });
  });

  it('removes the temporary file when the response exceeds the declared size', async () => {
    const downloadsPath = await createTempDirectory();
    const bytes = Buffer.from('too large');
    const update = {
      version: '0.1.10',
      fileName: 'StickyNotes-Mac-0.1.10.dmg',
      sha512: createHash('sha512').update(bytes).digest('base64'),
      size: bytes.length - 1
    };
    const service = createMacUpdateService({
      downloadsPath,
      fetch: vi.fn(async () => new Response(bytes, { status: 200 })),
      openPath: vi.fn(async () => '')
    });

    await expect(service.download(update, () => undefined)).rejects.toThrow('大小超出');
    await expect(readFile(join(downloadsPath, `${update.fileName}.download`))).rejects.toMatchObject({
      code: 'ENOENT'
    });
  });

  it('reports a native error when macOS cannot open the installer', async () => {
    const downloadsPath = await createTempDirectory();
    const service = createMacUpdateService({
      downloadsPath,
      fetch: vi.fn(),
      openPath: vi.fn(async () => '无法打开文件')
    });

    await expect(service.openInstaller('/Downloads/update.dmg')).rejects.toThrow('无法打开文件');
  });
});

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'sticky-notes-mac-update-'));
  tempDirectories.push(directory);
  return directory;
}
