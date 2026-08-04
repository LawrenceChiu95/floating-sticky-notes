const { buildWindows } = require('./windows-build.cjs');

buildWindows({
  output: 'release-diagnostic',
  artifactName: 'StickyNotes-Setup-0.1.17-Update-Diagnostic.${ext}',
  channel: 'latest'
});
