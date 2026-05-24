const { createPiPackageGenerator } = require('../shared.cjs');

async function packageGenerator(tree, options) {
  await createPiPackageGenerator(tree, options, 'package');
}

module.exports = packageGenerator;
module.exports.default = packageGenerator;
