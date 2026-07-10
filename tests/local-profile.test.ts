import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LOCAL_PROFILE_FILENAME,
  normalizeLocalProfile,
  readLocalProfile
} from '../main/local-profile';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('local profile compatibility', () => {
  it('accepts only a short non-empty display name', () => {
    expect(normalizeLocalProfile({ displayName: '  示例用户  ' })).toEqual({
      displayName: '示例用户'
    });
    expect(normalizeLocalProfile({ displayName: '' })).toBeUndefined();
    expect(normalizeLocalProfile({ displayName: 'a'.repeat(41) })).toBeUndefined();
    expect(normalizeLocalProfile({ displayName: 123 })).toBeUndefined();
  });

  it('reads an existing profile from userData', async () => {
    const userDataPath = await createUserDataPath();
    await writeFile(
      join(userDataPath, LOCAL_PROFILE_FILENAME),
      JSON.stringify({ displayName: '示例用户' }),
      'utf8'
    );

    await expect(readLocalProfile(userDataPath)).resolves.toEqual({ displayName: '示例用户' });
  });

  it('falls back to neutral copy when a profile is malformed', async () => {
    const userDataPath = await createUserDataPath();
    await writeFile(
      join(userDataPath, LOCAL_PROFILE_FILENAME),
      '{not-json',
      'utf8'
    );

    await expect(readLocalProfile(userDataPath)).resolves.toBeUndefined();
  });

  it('stays neutral when no profile exists', async () => {
    const userDataPath = await createUserDataPath();

    await expect(readLocalProfile(userDataPath)).resolves.toBeUndefined();
  });
});

async function createUserDataPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sticky-notes-profile-'));
  tempDirectories.push(root);
  const userDataPath = join(root, 'user-data');
  await mkdir(userDataPath);
  return userDataPath;
}
