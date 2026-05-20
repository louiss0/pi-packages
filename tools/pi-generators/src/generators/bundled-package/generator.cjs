const { createPiPackageGenerator } = require('../shared.cjs');

async function bundledPackageGenerator(tree, options) {
  await createPiPackageGenerator(tree, options, 'bundled');
}

module.exports = bundledPackageGenerator;
module.exports.default = bundledPackageGenerator;
