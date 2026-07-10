import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const LOCAL_PROFILE_FILENAME = 'personalization.json';

export type LocalProfile = {
  displayName: string;
};

export function normalizeLocalProfile(value: unknown): LocalProfile | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const displayName = (value as { displayName?: unknown }).displayName;
  if (typeof displayName !== 'string') {
    return undefined;
  }

  const normalizedName = displayName.trim();
  if (normalizedName.length === 0 || normalizedName.length > 40) {
    return undefined;
  }

  return { displayName: normalizedName };
}

export async function readLocalProfile(userDataPath: string): Promise<LocalProfile | undefined> {
  return readProfile(join(userDataPath, LOCAL_PROFILE_FILENAME));
}

async function readProfile(filePath: string): Promise<LocalProfile | undefined> {
  try {
    const value = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    return normalizeLocalProfile(value);
  } catch (error) {
    if (isFileMissingError(error)) {
      return undefined;
    }
    if (error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}

function isFileMissingError(error: unknown): boolean {
  return isNodeError(error) && error.code === 'ENOENT';
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
