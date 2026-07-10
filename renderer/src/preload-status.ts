type MaybeStickyNotesWindow = {
  stickyNotes?: {
    platform?: NodeJS.Platform;
  };
};

export function getPreloadStatus(target: MaybeStickyNotesWindow): string {
  const platform = target.stickyNotes?.platform;

  if (!platform) {
    return 'missing';
  }

  return `ready:${platform}`;
}
