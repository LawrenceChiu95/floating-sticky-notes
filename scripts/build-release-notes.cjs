const fs = require('node:fs');
const path = require('node:path');
const semver = require('semver');

const projectRoot = path.resolve(__dirname, '..');
const changelogPath = path.join(projectRoot, 'CHANGELOG.md');
const packagePath = path.join(projectRoot, 'package.json');
const generatedPath = path.join(projectRoot, 'main', 'generated', 'release-notes.ts');

function getStableReleaseVersion(version) {
  const parsed = semver.parse(version);
  if (!parsed) {
    throw new Error(`Invalid package version: ${version}`);
  }

  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

function parseReleaseDate(value, version) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) {
    throw new Error(`Invalid CHANGELOG date for ${version}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid CHANGELOG date for ${version}`);
  }

  return value;
}

function extractReleaseNotesArchive(changelog, packageVersion) {
  const stableVersion = getStableReleaseVersion(packageVersion);
  const headings = [...changelog.matchAll(/^##\s+.+$/gm)];
  const versionHeadings = [...changelog.matchAll(/^## \[([^\]]+)\](?: - ([^\n]+))?$/gm)]
    .filter((heading) => semver.valid(heading[1]) && semver.prerelease(heading[1]) === null);
  const versions = new Map();

  for (const heading of versionHeadings) {
    const version = heading[1];
    const matches = versions.get(version) ?? [];
    matches.push(heading);
    versions.set(version, matches);
  }

  const currentMatches = versions.get(stableVersion) ?? [];
  if (currentMatches.length === 0) {
    throw new Error(`Missing CHANGELOG chapter for ${stableVersion}`);
  }

  for (const [version, matches] of versions) {
    if (matches.length > 1) {
      throw new Error(`Duplicate CHANGELOG chapters for ${version}`);
    }
  }

  const releases = [...versions.entries()]
    .filter(([version]) => semver.lte(version, stableVersion))
    .map(([version, [heading]]) => {
      const chapterStart = heading.index + heading[0].length;
      const nextHeading = headings.find((candidate) => candidate.index > heading.index);
      const chapter = changelog.slice(chapterStart, nextHeading?.index ?? changelog.length);
      return {
        version,
        date: parseReleaseDate(heading[2], version),
        sections: parseReleaseChapter(chapter, version)
      };
    })
    .sort((left, right) => semver.compare(left.version, right.version));

  return { releases };
}

function parseReleaseChapter(chapter, version) {
  const sections = [];
  let currentSection;

  for (const line of chapter.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const sectionMatch = /^###\s+(.+?)\s*$/.exec(line);
    if (sectionMatch) {
      if (currentSection && currentSection.items.length === 0) {
        throw new Error(`Empty CHANGELOG category in ${version}`);
      }
      currentSection = { title: sectionMatch[1].trim(), items: [] };
      sections.push(currentSection);
      continue;
    }

    const itemMatch = /^-\s+(.+?)\s*$/.exec(line);
    if (itemMatch && currentSection) {
      currentSection.items.push(itemMatch[1].trim());
      continue;
    }

    throw new Error(`Unsupported CHANGELOG content in ${version}: ${trimmed}`);
  }

  if (!currentSection || currentSection.items.length === 0 || sections.length === 0) {
    throw new Error(`Empty CHANGELOG category in ${version}`);
  }

  return sections;
}

function generateReleaseNotesModule(releaseNotes, outputPath = generatedPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const source = `// Generated from CHANGELOG.md. Do not edit by hand.\nimport type { ReleaseNotesArchive } from '../../shared/release-notes';\n\nexport const BUILT_RELEASE_NOTES: ReleaseNotesArchive = ${JSON.stringify(releaseNotes, null, 2)};\n`;
  fs.writeFileSync(outputPath, source, 'utf8');
}

function generateFromRepository() {
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const changelog = fs.readFileSync(changelogPath, 'utf8');
  const releaseNotes = extractReleaseNotesArchive(changelog, packageJson.version);
  generateReleaseNotesModule(releaseNotes);
}

if (require.main === module) {
  generateFromRepository();
}

module.exports = {
  extractReleaseNotesArchive,
  generateReleaseNotesModule,
  getStableReleaseVersion
};
