import { readFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.argv[2];

if (!projectRoot) {
  console.error('Usage: node tools/validate-package-metadata.mjs <project-root>');
  process.exit(1);
}

const packageJsonPath = path.join(projectRoot, 'package.json');
const projectJsonPath = path.join(projectRoot, 'project.json');

const [packageJsonText, projectJsonText] = await Promise.all([
  readFile(packageJsonPath, 'utf8'),
  readFile(projectJsonPath, 'utf8'),
]);

const packageJson = JSON.parse(packageJsonText);
const projectJson = JSON.parse(projectJsonText);
const tags = new Set(projectJson.tags ?? []);
const keywords = new Set(packageJson.keywords ?? []);

if (tags.has('project:unbundled') && keywords.has('pi-package')) {
  console.error(
    `${projectRoot}/package.json must not include the \"pi-package\" keyword when the project is tagged project:unbundled.`,
  );
  process.exit(1);
}

console.log(`metadata ok: ${projectRoot}`);
