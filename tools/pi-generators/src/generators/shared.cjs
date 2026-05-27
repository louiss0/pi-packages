const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { formatFiles, readJson, writeJson } = require("@nx/devkit");

const packageScope = "@code-fixer-23";
const piPeerDependencies = {
  "@earendil-works/pi-coding-agent": "*",
  "@earendil-works/pi-tui": "*",
};
const repositoryUrl = "https://github.com/louiss0/pi-packages";
const packageTags = ["npm:public", "project:package", "status:supported"];
const extensionTags = ["npm:public", "project:extension", "status:supported"];

function normalizeProjectFolders(projectFolders = []) {
  const entries = Array.isArray(projectFolders)
    ? projectFolders
    : [projectFolders];
  const extras = new Set(["extensions"]);

  for (const entry of entries) {
    if (!entry) {
      continue;
    }

    if (!["extensions", "prompts", "skills"].includes(entry)) {
      throw new Error(
        `Unsupported project folder "${entry}". Use extensions, prompts, or skills.`,
      );
    }

    extras.add(entry);
  }

  return [...extras];
}

function getCreatePiPackageBin() {
  const packageJsonPath = require.resolve(
    "@code-fixer-23/create-pi-package/package.json",
  );
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const packageRoot = path.dirname(packageJsonPath);

  return path.resolve(packageRoot, packageJson.bin["create-pi-package"]);
}

function runCreatePiPackage(options) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-generators-"));
  const createPiPackageBin = getCreatePiPackageBin();
  const args = [
    createPiPackageBin,
    options.name,
    "--project-folders",
    ...options.projectFolders,
    "--runner",
    options.runner,
    "--no-install",
  ];

  if (options.instructions) {
    args.push("--instructions");
  }

  const result = spawnSync(process.execPath, args, {
    cwd: tempRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      result.stderr || result.stdout || "create-pi-package failed",
    );
  }

  return path.join(tempRoot, options.name);
}

function copyDirectoryToTree(tree, sourceRoot, targetRoot) {
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    const sourcePath = path.join(sourceRoot, entry.name);
    const targetPath = path.posix.join(targetRoot, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryToTree(tree, sourcePath, targetPath);
      continue;
    }

    tree.write(targetPath, fs.readFileSync(sourcePath, "utf8"));
  }
}

function updatePackageJson(tree, projectRoot, projectKind) {
  const packageJsonPath = `${projectRoot}/package.json`;
  const packageJson = readJson(tree, packageJsonPath);

  packageJson.name = `${packageScope}/${projectRoot}`;
  packageJson.version ??= "0.0.1";
  packageJson.private = false;
  packageJson.publishConfig = { access: "public" };
  packageJson.description ??= `Pi package scaffold for ${projectRoot}`;
  packageJson.repository = {
    type: "git",
    url: repositoryUrl,
    directory: projectRoot,
  };
  packageJson.homepage = repositoryUrl;
  packageJson.bugs = { url: `${repositoryUrl}/issues` };

  delete packageJson.scripts;

  packageJson.dependencies ??= {};

  for (const packageName of Object.keys(piPeerDependencies)) {
    delete packageJson.dependencies[packageName];
  }

  if (Object.keys(packageJson.dependencies).length === 0) {
    delete packageJson.dependencies;
  }

  packageJson.peerDependencies = {
    ...packageJson.peerDependencies,
    ...piPeerDependencies,
  };

  if (packageJson.devDependencies?.tsx) {
    delete packageJson.devDependencies.tsx;
  }

  if (projectKind !== "extension") {
    delete packageJson.keywords;
  }

  writeJson(tree, packageJsonPath, packageJson);
}

function getTestTarget(runner) {
  if (runner === "jest") {
    return {
      executor: "nx:run-commands",
      options: {
        command: "pnpm exec jest --config jest.config.cjs --passWithNoTests",
        cwd: "{projectRoot}",
      },
    };
  }

  return {
    executor: "nx:run-commands",
    options: {
      command:
        "pnpm exec vitest run --config vitest.config.ts --passWithNoTests",
      cwd: "{projectRoot}",
    },
  };
}

function writeProjectJson(tree, projectRoot, projectKind, runner) {
  const tags = projectKind === "package" ? packageTags : extensionTags;
  const projectJsonPath = `${projectRoot}/project.json`;
  const projectJson = {
    name: projectRoot,
    $schema: "../node_modules/nx/schemas/project-schema.json",
    projectType: "library",
    root: projectRoot,
    sourceRoot: `${projectRoot}/extensions`,
    targets: {
      typecheck: {
        executor: "nx:run-commands",
        options: {
          command: "tsc -p tsconfig.json --noEmit",
          cwd: "{projectRoot}",
        },
      },
      test: getTestTarget(runner),
      lint: {
        executor: "@nx/eslint:lint",
        options: {
          lintFilePatterns: [
            "{projectRoot}/**/*.ts",
            "{projectRoot}/**/*.js",
            "{projectRoot}/**/*.mts",
            "{projectRoot}/**/*.mjs",
            "{projectRoot}/**/*.cts",
            "{projectRoot}/**/*.cjs",
          ],
        },
      },
      biome: {
        executor: "nx:run-commands",
        options: {
          command:
            "pnpm exec biome format --config-path biome.json {projectRoot}",
          cwd: "{workspaceRoot}",
        },
      },
      format: {
        executor: "nx:run-commands",
        options: {
          command:
            "pnpm exec biome format --write --config-path biome.json {projectRoot}",
          cwd: "{workspaceRoot}",
        },
      },
      metadata: {
        executor: "nx:run-commands",
        options: {
          command: "node tools/validate-package-metadata.mjs {projectRoot}",
        },
      },
      check: {
        executor: "nx:run-commands",
        dependsOn: ["typecheck", "lint", "test", "metadata"],
        options: {
          command: "echo 'All checks passed'",
        },
      },
    },
    tags,
  };

  writeJson(tree, projectJsonPath, projectJson);
}

function updatePnpmWorkspace(tree, projectRoot) {
  const workspacePath = "pnpm-workspace.yaml";
  const currentContent = tree.read(workspacePath, "utf8");

  if (!currentContent || currentContent.includes(`  - "${projectRoot}"`)) {
    return;
  }

  const nextContent = currentContent.replace(
    '  - "tools/pi-generators"\n',
    `  - "tools/pi-generators"\n  - "${projectRoot}"\n`,
  );

  tree.write(workspacePath, nextContent);
}

function updateTsConfigReferences(tree, projectRoot) {
  const tsconfigPath = "tsconfig.json";
  const tsconfig = readJson(tree, tsconfigPath);
  const references = tsconfig.references ?? [];

  if (references.some((reference) => reference.path === `./${projectRoot}`)) {
    return;
  }

  references.push({ path: `./${projectRoot}` });
  tsconfig.references = references;

  writeJson(tree, tsconfigPath, tsconfig);
}

async function createPiPackageGenerator(tree, options, projectKind) {
  if (!options.name) {
    throw new Error("A package name is required.");
  }

  if (tree.exists(options.name)) {
    throw new Error(`The path ${options.name} already exists.`);
  }

  const projectFolders = normalizeProjectFolders(options.projectFolders);
  const generatedRoot = runCreatePiPackage({
    instructions: options.instructions === true,
    name: options.name,
    projectFolders,
    runner: options.runner ?? "vitest",
  });

  copyDirectoryToTree(tree, generatedRoot, options.name);
  updatePackageJson(tree, options.name, projectKind);
  writeProjectJson(tree, options.name, projectKind, options.runner ?? "vitest");
  updatePnpmWorkspace(tree, options.name);
  updateTsConfigReferences(tree, options.name);

  await formatFiles(tree);
}

module.exports = {
  createPiPackageGenerator,
};
