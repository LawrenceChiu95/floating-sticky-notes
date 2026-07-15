export type ReleaseNotesSection = {
  title: string;
  items: string[];
};

export type ReleaseNotes = {
  sourceVersion: string;
  sections: ReleaseNotesSection[];
};

export function formatReleaseNotesDetail(releaseNotes: ReleaseNotes | undefined): string {
  if (!releaseNotes || releaseNotes.sections.length === 0) {
    return '本版本暂无更新说明';
  }

  return releaseNotes.sections
    .map((section) => `${section.title}\n${section.items.map((item) => `• ${item}`).join('\n')}`)
    .join('\n\n');
}
