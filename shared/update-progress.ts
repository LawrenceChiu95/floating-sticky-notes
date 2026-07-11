export const UPDATE_PROGRESS_CHANNEL = 'update-progress:snapshot';

export type UpdateProgressSnapshot = {
  state: 'preparing' | 'downloading';
  version?: string;
  percent?: number;
};

export function createPreparingSnapshot(version?: string): UpdateProgressSnapshot {
  return {
    state: 'preparing',
    ...(version ? { version } : {})
  };
}

export function createDownloadingSnapshot(
  value: unknown,
  version?: string
): UpdateProgressSnapshot {
  const rawPercent =
    value && typeof value === 'object'
      ? (value as { percent?: unknown }).percent
      : undefined;
  const percent =
    typeof rawPercent === 'number' && Number.isFinite(rawPercent)
      ? Math.round(Math.min(100, Math.max(0, rawPercent)))
      : undefined;

  return {
    state: 'downloading',
    ...(version ? { version } : {}),
    ...(percent === undefined ? {} : { percent })
  };
}
