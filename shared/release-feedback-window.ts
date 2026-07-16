import type { ReleaseNotes } from './release-notes';

export const RELEASE_FEEDBACK_RENDER_TIMEOUT_MS = 3000;

export const RELEASE_FEEDBACK_CHANNELS = {
  snapshot: 'release-feedback:snapshot',
  rendered: 'release-feedback:rendered',
  dismiss: 'release-feedback:dismiss'
} as const;

export type ReleaseFeedbackSource = 'automatic' | 'manual';

export type ReleaseFeedbackSnapshot = {
  initiatedBy: ReleaseFeedbackSource;
  version: string;
  releases: ReleaseNotes[];
};

export type ReleaseFeedbackPresentationResult = {
  source: ReleaseFeedbackSource;
  shown: boolean;
};

export type ReleaseFeedbackRenderedPayload = {
  contentHeight: number;
};

export function isReleaseFeedbackSnapshot(
  value: unknown
): value is ReleaseFeedbackSnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const snapshot = value as Partial<ReleaseFeedbackSnapshot>;
  return (
    (snapshot.initiatedBy === 'automatic' || snapshot.initiatedBy === 'manual') &&
    typeof snapshot.version === 'string' &&
    snapshot.version.length > 0 &&
    Array.isArray(snapshot.releases) &&
    snapshot.releases.every(isReleaseNotes)
  );
}

export function isReleaseFeedbackRenderedPayload(
  value: unknown
): value is ReleaseFeedbackRenderedPayload {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const payload = value as Partial<ReleaseFeedbackRenderedPayload>;
  return (
    typeof payload.contentHeight === 'number' &&
    Number.isFinite(payload.contentHeight) &&
    payload.contentHeight >= 0
  );
}

function isReleaseNotes(value: unknown): value is ReleaseNotes {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const release = value as Partial<ReleaseNotes>;
  return (
    typeof release.version === 'string' &&
    release.version.length > 0 &&
    isReleaseDate(release.date) &&
    Array.isArray(release.sections) &&
    release.sections.length > 0 &&
    release.sections.every(
      (section) =>
        Boolean(section) &&
        typeof section === 'object' &&
        typeof section.title === 'string' &&
        section.title.length > 0 &&
        Array.isArray(section.items) &&
        section.items.length > 0 &&
        section.items.every((item) => typeof item === 'string' && item.length > 0)
    )
  );
}

function isReleaseDate(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
