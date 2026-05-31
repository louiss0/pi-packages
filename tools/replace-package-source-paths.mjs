import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const packageRoot = process.argv[2];
const buildFolderName = process.argv[3] ?? "dist";

if (!packageRoot) {
  console.error(
    "Usage: node tools/replace-package-source-paths.mjs <package-root> [build-folder-name]",
  );
  process.exit(1);
}

const packageJsonPath = path.join(packageRoot, "package.json");
const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));

function getProductionPath(value) {
  if (typeof value !== "string") {
    return value;
  }

  function getBuildPath(sourcePath) {
    return sourcePath.replace(/\.(c|m)?tsx?$/, ".js");
  }

  if (value.startsWith("./src/")) {
    return getBuildPath(value.replace("./src/", `./${buildFolderName}/`));
  }

  if (value.startsWith("src/")) {
    return getBuildPath(value.replace("src/", `${buildFolderName}/`));
  }

  return value;
}

function getProductionEntry(value) {
  if (Array.isArray(value)) {
    return value.map(getProductionEntry);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        getProductionEntry(entryValue),
      ]),
    );
  }

  return getProductionPath(value);
}

const packageEntries = ["main", "module", "types", "exports", "bin", "pi"];

for (const packageEntry of packageEntries) {
  if (packageJson[packageEntry] !== undefined) {
    packageJson[packageEntry] = getProductionEntry(packageJson[packageEntry]);
  }
}

await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
