import { readFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.argv[2];

if (!projectRoot) {
  console.error(
    "Usage: node tools/validate-package-metadata.mjs <project-root>",
  );
  process.exit(1);
}

const packageJsonPath = path.join(projectRoot, "package.json");
const projectJsonPath = path.join(projectRoot, "project.json");

const [packageJsonText, projectJsonText] = await Promise.all([
  readFile(packageJsonPath, "utf8"),
  readFile(projectJsonPath, "utf8"),
]);

const packageJson = JSON.parse(packageJsonText);
const projectJson = JSON.parse(projectJsonText);
const tags = new Set(projectJson.tags ?? []);
const keywords = new Set(packageJson.keywords ?? []);
const expectedRepository = {
  type: "git",
  url: "https://github.com/louiss0/pi-packages",
  directory: projectRoot,
};

if (tags.has("project:extension") && !keywords.has("pi-package")) {
  console.error(
    `${projectRoot}/package.json must include the "pi-package" keyword when the project is tagged project:extension.`,
  );
  process.exit(1);
}

if (
  typeof packageJson.repository !== "object" ||
  packageJson.repository === null ||
  packageJson.repository.type !== expectedRepository.type ||
  packageJson.repository.url !== expectedRepository.url ||
  packageJson.repository.directory !== expectedRepository.directory
) {
  console.error(
    `${projectRoot}/package.json must use repository metadata with type, url, and directory fields matching the workspace repository.`,
  );
  process.exit(1);
}

console.log(`metadata ok: ${projectRoot}`);
