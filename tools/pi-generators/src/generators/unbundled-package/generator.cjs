const { createPiPackageGenerator } = require('../shared.cjs');

async function unbundledPackageGenerator(tree, options) {
  await createPiPackageGenerator(tree, options, 'unbundled');
}

module.exports = unbundledPackageGenerator;
module.exports.default = unbundledPackageGenerator;
