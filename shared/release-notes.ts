export type ReleaseNotesSection = {
  title: string;
  items: string[];
};

export type ReleaseNotes = {
  version: string;
  date: string;
  sections: ReleaseNotesSection[];
};

export type ReleaseNotesArchive = {
  releases: ReleaseNotes[];
};
