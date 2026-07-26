const secureBraceExpansion = require('brace-expansion-secure');

const expand = secureBraceExpansion.expand;

module.exports = expand;
module.exports.expand = expand;
module.exports.default = expand;
module.exports.EXPANSION_MAX = secureBraceExpansion.EXPANSION_MAX;
module.exports.EXPANSION_MAX_LENGTH = secureBraceExpansion.EXPANSION_MAX_LENGTH;
