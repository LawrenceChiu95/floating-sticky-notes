const { buildWindows } = require('./windows-build.cjs');

buildWindows({
  output: 'release',
  artifactName: 'StickyNotes-Setup-${version}.${ext}',
  channel: 'latest'
});
