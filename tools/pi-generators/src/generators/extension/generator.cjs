const { createPiPackageGenerator } = require('../shared.cjs');

async function extensionGenerator(tree, options) {
  await createPiPackageGenerator(tree, options, 'extension');
}

module.exports = extensionGenerator;
module.exports.default = extensionGenerator;
