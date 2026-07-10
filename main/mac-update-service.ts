import { createHash } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { valid } from 'semver';
import { parse } from 'yaml';
import type { MacUpdateInfo, MacUpdateService } from './mac-update-controller';

const MAC_UPDATE_BASE_URL =
  'https://github.com/LawrenceChiu95/floating-sticky-notes-updates/releases/latest/download';

export const MAC_UPDATE_METADATA_URL = `${MAC_UPDATE_BASE_URL}/latest-mac.yml`;

type MacUpdateServiceOptions = {
  downloadsPath: string;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  openPath: (filePath: string) => Promise<string>;
};

export function normalizeMacUpdateMetadata(value: unknown): MacUpdateInfo | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const raw = value as {
    version?: unknown;
    path?: unknown;
    sha512?: unknown;
    files?: unknown;
  };
  const version = typeof raw.version === 'string' ? valid(raw.version.trim()) : null;
  const fileName = typeof raw.path === 'string' ? raw.path.trim() : '';
  const sha512 = typeof raw.sha512 === 'string' ? raw.sha512.trim() : '';
  if (
    !version ||
    fileName !== `StickyNotes-Mac-${version}.dmg` ||
    basename(fileName) !== fileName ||
    !isSha512(sha512) ||
    !Array.isArray(raw.files)
  ) {
    return undefined;
  }

  const matchingFile = raw.files.find((file) => {
    if (!file || typeof file !== 'object') {
      return false;
    }
    const candidate = file as { url?: unknown; sha512?: unknown };
    return candidate.url === fileName && candidate.sha512 === sha512;
  }) as { size?: unknown } | undefined;
  const size = matchingFile?.size;

  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) {
    return undefined;
  }

  return { version, fileName, sha512, size };
}

export function createMacUpdateService(options: MacUpdateServiceOptions): MacUpdateService {
  const getLatest = async (): Promise<MacUpdateInfo> => {
    const response = await options.fetch(MAC_UPDATE_METADATA_URL, {
      cache: 'no-store',
      headers: { accept: 'application/yaml, text/yaml, text/plain' }
    });
    if (!response.ok) {
      throw new Error(`更新元数据请求失败：HTTP ${response.status}`);
    }

    const text = await response.text();
    if (text.length > 64 * 1024) {
      throw new Error('更新元数据大小异常');
    }

    const update = normalizeMacUpdateMetadata(parse(text) as unknown);
    if (!update) {
      throw new Error('更新元数据格式无效');
    }
    return update;
  };

  const download = async (
    update: MacUpdateInfo,
    onProgress: (progress: number) => void
  ): Promise<string> => {
    const response = await options.fetch(
      `${MAC_UPDATE_BASE_URL}/${encodeURIComponent(update.fileName)}`,
      { cache: 'no-store' }
    );
    const body = response.body;
    if (!response.ok || !body) {
      throw new Error(`安装镜像下载失败：HTTP ${response.status}`);
    }

    const finalPath = join(options.downloadsPath, update.fileName);
    const temporaryPath = `${finalPath}.download`;
    await rm(temporaryPath, { force: true });
    const hash = createHash('sha512');
    let file: Awaited<ReturnType<typeof open>> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let received = 0;

    try {
      file = await open(temporaryPath, 'w');
      reader = body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const chunk = Buffer.from(value);
        if (received + chunk.length > update.size) {
          throw new Error('安装镜像大小超出更新元数据');
        }
        let chunkOffset = 0;
        while (chunkOffset < chunk.length) {
          const { bytesWritten } = await file.write(
            chunk,
            chunkOffset,
            chunk.length - chunkOffset,
            received + chunkOffset
          );
          if (bytesWritten <= 0) {
            throw new Error('安装镜像写入失败');
          }
          chunkOffset += bytesWritten;
        }
        received += chunk.length;
        hash.update(chunk);
        onProgress(received / update.size);
      }

      await file.close();
      file = undefined;
      reader.releaseLock();
      reader = undefined;

      const actualSha512 = hash.digest('base64');
      if (received !== update.size || actualSha512 !== update.sha512) {
        throw new Error('安装镜像校验失败');
      }

      await rename(temporaryPath, finalPath);
      return finalPath;
    } catch (error) {
      await reader?.cancel().catch(() => undefined);
      await file?.close().catch(() => undefined);
      await rm(temporaryPath, { force: true });
      throw error;
    }
  };

  return {
    getLatest,
    download,
    openInstaller: async (filePath) => {
      const errorMessage = await options.openPath(filePath);
      if (errorMessage) {
        throw new Error(errorMessage);
      }
    }
  };
}

function isSha512(value: string): boolean {
  try {
    const decoded = Buffer.from(value, 'base64');
    return decoded.length === 64 && decoded.toString('base64') === value;
  } catch {
    return false;
  }
}
