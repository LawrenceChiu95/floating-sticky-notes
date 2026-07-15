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

function extractReleaseNotes(changelog, packageVersion) {
  const stableVersion = getStableReleaseVersion(packageVersion);
  const headings = [...changelog.matchAll(/^##\s+.+$/gm)];
  const versionHeadings = [...changelog.matchAll(/^## \[([^\]]+)\][^\n]*$/gm)];
  const matches = versionHeadings.filter((heading) => heading[1] === stableVersion);

  if (matches.length === 0) {
    throw new Error(`Missing CHANGELOG chapter for ${stableVersion}`);
  }
  if (matches.length > 1) {
    throw new Error(`Duplicate CHANGELOG chapters for ${stableVersion}`);
  }

  const chapterStart = matches[0].index + matches[0][0].length;
  const nextHeading = headings.find((heading) => heading.index > matches[0].index);
  const chapter = changelog.slice(chapterStart, nextHeading?.index ?? changelog.length);
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
        throw new Error(`Empty CHANGELOG category in ${stableVersion}`);
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

    throw new Error(`Unsupported CHANGELOG content in ${stableVersion}: ${trimmed}`);
  }

  if (!currentSection || currentSection.items.length === 0 || sections.length === 0) {
    throw new Error(`CHANGELOG chapter for ${stableVersion} has no supported entries`);
  }

  return { sourceVersion: stableVersion, sections };
}

function generateReleaseNotesModule(releaseNotes, outputPath = generatedPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const source = `// Generated from CHANGELOG.md. Do not edit by hand.\nimport type { ReleaseNotes } from '../../shared/release-notes';\n\nexport const BUILT_RELEASE_NOTES: ReleaseNotes = ${JSON.stringify(releaseNotes, null, 2)};\n`;
  fs.writeFileSync(outputPath, source, 'utf8');
}

function generateFromRepository() {
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const changelog = fs.readFileSync(changelogPath, 'utf8');
  const releaseNotes = extractReleaseNotes(changelog, packageJson.version);
  generateReleaseNotesModule(releaseNotes);
}

if (require.main === module) {
  generateFromRepository();
}

module.exports = {
  extractReleaseNotes,
  generateReleaseNotesModule,
  getStableReleaseVersion
};
