import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const packageRoot = process.argv[2];
const bundledPackageRoot = process.argv[3];

if (!packageRoot || !bundledPackageRoot) {
  console.error(
    "Usage: node tools/prepare-bundled-package.mjs <package-root> <destination>",
  );
  process.exit(1);
}

const packageJsonPath = path.join(packageRoot, "package.json");
const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const resolvedPackageRoot = path.resolve(packageRoot);
const resolvedBundledPackageRoot = path.resolve(bundledPackageRoot);
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
    return getBuildPath(value.replace("./src/", "./"), entryKey);
  }

  if (value.startsWith("src/")) {
    return getBuildPath(value.replace("src/", ""), entryKey);
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

if (resolvedPackageRoot !== resolvedBundledPackageRoot) {
  await rm(resolvedBundledPackageRoot, { force: true, recursive: true });
  await mkdir(resolvedBundledPackageRoot, { recursive: true });
  await cp(path.join(resolvedPackageRoot, "dist"), resolvedBundledPackageRoot, {
    recursive: true,
  });
} else {
  await mkdir(resolvedBundledPackageRoot, { recursive: true });
}
await writeFile(
  path.join(resolvedBundledPackageRoot, "package.json"),
  `${JSON.stringify(packageJson, null, 2)}\n`,
);
