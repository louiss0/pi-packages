const fs = require("node:fs");
const path = require("node:path");

const packageEntries = ["main", "module", "types", "exports", "bin", "pi"];

function getTypeBuildPath(sourcePath) {
  if (/\.d\.ts$/.test(sourcePath)) {
    return sourcePath;
  }

  return sourcePath.replace(/\.(c|m)?tsx?$/, ".d.ts");
}

function getJavaScriptBuildPath(sourcePath) {
  return sourcePath.replace(/\.(c|m)?tsx?$/, ".js");
}

function getProductionPath(value, entryKey) {
  if (typeof value !== "string") {
    return value;
  }

  if (!value.startsWith("./src/") && !value.startsWith("src/")) {
    return value;
  }

  const normalizedValue = value.startsWith("./") ? value : `./${value}`;

  if (entryKey === "types") {
    return getTypeBuildPath(normalizedValue);
  }

  return getJavaScriptBuildPath(normalizedValue.replace("./src/", "./"));
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

function getPackageRootFromEntryPoint(entryPoint) {
  const normalizedEntryPoint = entryPoint.replace(/\\/g, "/");
  const sourceDirectoryIndex = normalizedEntryPoint.lastIndexOf("/src/");

  if (sourceDirectoryIndex < 0) {
    throw new Error(
      `Expected entry point to contain /src/, received: ${entryPoint}`,
    );
  }

  return normalizedEntryPoint.slice(0, sourceDirectoryIndex);
}

function writeBundledPackageJson(outdir, entryPoint) {
  const workspaceRoot = process.cwd();
  const packageRoot = getPackageRootFromEntryPoint(entryPoint);
  const sourcePackageJsonPath = path.join(workspaceRoot, packageRoot, "package.json");
  const bundledPackageJsonPath = path.join(outdir, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(sourcePackageJsonPath, "utf8"));

  for (const packageEntry of packageEntries) {
    if (packageJson[packageEntry] === undefined) {
      continue;
    }

    packageJson[packageEntry] = getProductionEntry(
      packageJson[packageEntry],
      packageEntry,
    );
  }

  fs.writeFileSync(
    bundledPackageJsonPath,
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );
}

module.exports = {
  plugins: [
    {
      name: "write-bundled-package-json",
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length > 0) {
            return;
          }

          const outdir = build.initialOptions.outdir ?? path.dirname(build.initialOptions.outfile ?? "");
          const entryPoint = build.initialOptions.entryPoints?.[0];

          if (!outdir || typeof entryPoint !== "string") {
            return;
          }

          writeBundledPackageJson(outdir, entryPoint);
        });
      },
    },
  ],
};
