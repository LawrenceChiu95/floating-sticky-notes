import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NoteImageRecord } from './note-state';

export const IMAGE_PROTOCOL = 'sticky-notes-image';
const IMAGE_PROTOCOL_HOST = 'local';
const SAFE_IMAGE_FILENAME_PATTERN = /^[A-Za-z0-9_-]+\.png$/;

export type SaveImageInput = {
  data: Uint8Array;
  width: number;
  height: number;
};

export type NoteImageStorage = {
  saveImage: (input: SaveImageInput) => Promise<NoteImageRecord>;
  getImageSource: (image: NoteImageRecord) => string;
  deleteImage: (image: NoteImageRecord) => Promise<void>;
};

type LocalImageStorageOptions = {
  createId?: () => string;
  now?: () => string;
};

export class LocalImageStorage implements NoteImageStorage {
  private readonly createId: () => string;
  private readonly now: () => string;

  constructor(
    private readonly imagesDir: string,
    options: LocalImageStorageOptions = {}
  ) {
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async saveImage(input: SaveImageInput): Promise<NoteImageRecord> {
    const id = this.createId();
    const filename = `${id}.png`;

    await mkdir(this.imagesDir, { recursive: true });
    await writeFile(join(this.imagesDir, filename), input.data);

    return {
      id,
      filename,
      width: input.width,
      height: input.height,
      createdAt: this.now()
    };
  }

  getImageSource(image: NoteImageRecord): string {
    return `${IMAGE_PROTOCOL}://${IMAGE_PROTOCOL_HOST}/${encodeURIComponent(image.filename)}`;
  }

  async deleteImage(image: NoteImageRecord): Promise<void> {
    await rm(join(this.imagesDir, image.filename), {
      force: true
    });
  }

  async createImageResponse(url: string): Promise<Response> {
    const filename = getImageFilenameFromSource(url);

    if (!filename) {
      return createNotFoundResponse();
    }

    try {
      const imageBytes = await readFile(join(this.imagesDir, filename));
      return new Response(new Uint8Array(imageBytes), {
        status: 200,
        headers: {
          'content-type': 'image/png'
        }
      });
    } catch {
      return createNotFoundResponse();
    }
  }
}

export function isSafeImageFilename(filename: string): boolean {
  return SAFE_IMAGE_FILENAME_PATTERN.test(filename);
}

function getImageFilenameFromSource(source: string): string | undefined {
  try {
    const url = new URL(source);

    if (url.protocol !== `${IMAGE_PROTOCOL}:` || url.hostname !== IMAGE_PROTOCOL_HOST) {
      return undefined;
    }

    const filename = decodeURIComponent(url.pathname.replace(/^\//, ''));
    return isSafeImageFilename(filename) ? filename : undefined;
  } catch {
    return undefined;
  }
}

function createNotFoundResponse(): Response {
  return new Response(null, {
    status: 404
  });
}
