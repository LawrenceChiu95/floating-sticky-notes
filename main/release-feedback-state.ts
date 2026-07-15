import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { valid } from 'semver';

export const RELEASE_FEEDBACK_STATE_FILENAME = 'release-feedback.json';

export type ReleaseFeedbackStateLoadResult =
  | {
      kind: 'available';
      lastShownReleaseVersion?: string;
    }
  | {
      kind: 'unavailable';
    };

export type ReleaseFeedbackStateStore = {
  load: () => Promise<ReleaseFeedbackStateLoadResult>;
  save: (version: string) => Promise<void>;
};

export type ReleaseFeedbackStateStoreOptions = {
  filePath: string;
  readFile?: (filePath: string, encoding: BufferEncoding) => Promise<string>;
  mkdir?: (directoryPath: string, options: { recursive: true }) => Promise<unknown>;
  writeFile?: (
    filePath: string,
    content: string,
    encoding: BufferEncoding
  ) => Promise<unknown>;
  logWarning?: (message: string, error: unknown) => void;
};

export function createReleaseFeedbackStateStore(
  options: ReleaseFeedbackStateStoreOptions
): ReleaseFeedbackStateStore {
  const read =
    options.readFile ??
    ((filePath: string, encoding: BufferEncoding) => readFile(filePath, encoding));
  const makeDirectory =
    options.mkdir ??
    ((directoryPath: string, mkdirOptions: { recursive: true }) =>
      mkdir(directoryPath, mkdirOptions));
  const write =
    options.writeFile ??
    ((filePath: string, content: string, encoding: BufferEncoding) =>
      writeFile(filePath, content, encoding));
  const logWarning = options.logWarning ?? ((message, error) => console.warn(message, error));

  return {
    async load(): Promise<ReleaseFeedbackStateLoadResult> {
      let raw: string;
      try {
        raw = await read(options.filePath, 'utf8');
      } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
          return { kind: 'available' };
        }

        logWarning('Unable to read release feedback state', error);
        return { kind: 'unavailable' };
      }

      try {
        const parsed = JSON.parse(raw) as unknown;
        const version = normalizeStateVersion(parsed);
        if (!version) {
          throw new Error('Release feedback state has an invalid version');
        }

        return {
          kind: 'available',
          lastShownReleaseVersion: version
        };
      } catch (error) {
        logWarning('Release feedback state is invalid; treating it as empty', error);
        return { kind: 'available' };
      }
    },

    async save(version: string): Promise<void> {
      if (!valid(version)) {
        throw new Error('Cannot save an invalid release feedback version');
      }

      await makeDirectory(dirname(options.filePath), { recursive: true });
      await write(
        options.filePath,
        `${JSON.stringify({ lastShownReleaseVersion: version }, null, 2)}\n`,
        'utf8'
      );
    }
  };
}

function normalizeStateVersion(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as { lastShownReleaseVersion?: unknown };
  return typeof candidate.lastShownReleaseVersion === 'string'
    ? valid(candidate.lastShownReleaseVersion.trim()) ?? undefined
    : undefined;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
