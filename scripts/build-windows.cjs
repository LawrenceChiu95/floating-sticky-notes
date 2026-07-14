const { buildWindows, getPublishChannel } = require('./windows-build.cjs');
const { version } = require('../package.json');

buildWindows({
  output: 'release',
  artifactName: 'StickyNotes-Setup-${version}.${ext}',
  channel: getPublishChannel(version)
});
