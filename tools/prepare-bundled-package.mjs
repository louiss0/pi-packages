import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const packageRoot = process.argv[2];
const bundledRoot = process.argv[3];
const buildFolderName = process.argv[4] ?? "dist";

if (!packageRoot || !bundledRoot) {
  console.error(
    "Usage: node tools/prepare-bundled-package.mjs <package-root> <bundled-root> [build-folder-name]",
  );
  process.exit(1);
}

const packageJsonPath = path.join(packageRoot, "package.json");
const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const resolvedPackageRoot = path.resolve(packageRoot);
const bundledPackageRoot = path.join(
  bundledRoot,
  path.basename(resolvedPackageRoot),
);
const packageEntries = ["main", "module", "types", "exports", "bin", "pi"];

function getBuildPath(sourcePath, entryKey) {
  if (entryKey === "types") {
    return sourcePath.replace(/(?:\.d)?\.(c|m)?tsx?$/, ".d.ts");
  }

  return sourcePath.replace(/\.(c|m)?tsx?$/, ".js");
}

function getProductionPath(value, entryKey) {
  if (typeof value !== "string") {
    return value;
  }

  if (value.startsWith("./src/")) {
    return getBuildPath(
      value.replace("./src/", `./${buildFolderName}/`),
      entryKey,
    );
  }

  if (value.startsWith("src/")) {
    return getBuildPath(value.replace("src/", `${buildFolderName}/`), entryKey);
  }

  return value;
}

function getProductionEntry(value, entryKey) {
  if (Array.isArray(value)) {
    return value.map((entryValue) => getProductionEntry(entryValue, entryKey));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        getProductionEntry(entryValue, key),
      ]),
    );
  }

  return getProductionPath(value, entryKey);
}

for (const packageEntry of packageEntries) {
  if (packageJson[packageEntry] !== undefined) {
    packageJson[packageEntry] = getProductionEntry(
      packageJson[packageEntry],
      packageEntry,
    );
  }
}

await rm(bundledPackageRoot, { force: true, recursive: true });
await mkdir(bundledPackageRoot, { recursive: true });
await cp(
  path.join(packageRoot, buildFolderName),
  path.join(bundledPackageRoot, buildFolderName),
  { recursive: true },
);
await writeFile(
  path.join(bundledPackageRoot, "package.json"),
  `${JSON.stringify(packageJson, null, 2)}\n`,
);
