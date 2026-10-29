/**
 * Verify the package users actually install, rather than the workspace link.
 *
 * The fixture is deliberately created in the OS temp directory: pack and
 * install must not be able to resolve this package through the workspace.
 *
 * What this proves, and nothing more:
 * - the packed tarball installs with only its declared dependencies and peers;
 * - its declared engine floor is preserved;
 * - a TypeScript consumer type-checks the settings utility from the install;
 * - the installed source extension loads through the real Pi resource loader
 *   (no loader errors), binds, and registers tools without a public runtime;
 * - the installed license retains the consolidated upstream MIT notice.
 */

import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const packageRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(packageRoot, "..");
const tempRoot = await mkdtemp(join(tmpdir(), "pi-tiered-release-"));
const packDir = join(tempRoot, "pack");
const installRoot = join(tempRoot, "consumer");

const NODE_FLOOR = ">=22.19.0";
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

/**
 * One argument, quoted only when the platform shell needs it. Quoting the
 * command name itself breaks `cmd.exe`, which treats a leading quote specially.
 */
function quoteArgument(argument) {
  if (!/[\s"]/.test(argument)) return argument;
  if (process.platform === "win32") {
    return `"${argument.replaceAll('"', '\\"')}"`;
  }
  const single = String.fromCharCode(39);
  return `${single}${argument.split(single).join(`${single}\\${single}${single}`)}${single}`;
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    // `pnpm.cmd` can only be spawned through a shell on Windows, so both
    // platforms go through the same quoted command line.
    const line = [command, ...args].map(quoteArgument).join(" ");
    const child = spawn(line, {
      ...options,
      cwd: options.cwd ?? packageRoot,
      shell: true,
      stdio: options.stdio ?? "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${line} exited ${code ?? `via ${signal}`}`));
    });
  });
}

/**
 * Versions come from the workspace store, so the fixture pins the peers the
 * package was developed against without asking a registry.
 */
async function installedVersion(name) {
  const manifestPath = join(
    workspaceRoot,
    "node_modules",
    ...name.split("/"),
    "package.json",
  );
  return (await readJson(manifestPath)).version;
}

try {
  const manifest = await readJson(join(packageRoot, "package.json"));
  if (manifest.engines?.node !== NODE_FLOOR) {
    throw new Error(`package.json must declare engines.node ${NODE_FLOOR}`);
  }

  await mkdir(packDir, { recursive: true });
  await run(pnpmCommand, [
    "pack",
    "--dir",
    packageRoot,
    "--pack-destination",
    packDir,
    "--silent",
  ]);
  const tarballs = (await readdir(packDir)).filter((name) =>
    name.endsWith(".tgz"),
  );
  if (tarballs.length !== 1) {
    throw new Error(`expected one tarball, found ${tarballs.length}`);
  }
  const tarball = join(packDir, tarballs[0]);
  const tarballSpec =
    process.platform === "win32" ? tarball.replaceAll("\\", "/") : tarball;

  // The fixture pins the peers and dev tools the package is developed against.
  const fixtureDependencies = new Map();
  for (const name of Object.keys(manifest.peerDependencies ?? {})) {
    fixtureDependencies.set(name, await installedVersion(name));
  }
  for (const name of ["typebox", "typescript", "@types/node"]) {
    fixtureDependencies.set(name, await installedVersion(name));
  }
  await mkdir(installRoot, { recursive: true });
  await run(pnpmCommand, [
    "add",
    "--dir",
    installRoot,
    "--prefer-offline",
    "--ignore-workspace",
    "--ignore-scripts",
    "--save-exact",
    `${manifest.name}@${tarballSpec}`,
    ...[...fixtureDependencies].map(([name, version]) => `${name}@${version}`),
  ]);

  const installedRoot = join(
    installRoot,
    "node_modules",
    ...manifest.name.split("/"),
  );
  const installedManifest = await readJson(join(installedRoot, "package.json"));
  if (installedManifest.engines?.node !== NODE_FLOOR) {
    throw new Error(
      `packed package declares engines.node ${String(installedManifest.engines?.node)}, expected ${NODE_FLOOR}`,
    );
  }

  const installedLicense = await readFile(
    join(installedRoot, "LICENSE"),
    "utf8",
  );
  for (const notice of [
    "Copyright (c) 2026 Shelton Louis",
    "Copyright (c) 2026 tintinweb",
    "Permission is hereby granted, free of charge",
  ]) {
    if (!installedLicense.includes(notice)) {
      throw new Error(`packed license is missing notice: ${notice}`);
    }
  }

  await writeFile(
    join(installRoot, "consumer.ts"),
    `import {
  loadLayeredSettings,
  type LayeredSettingsSource,
} from ${JSON.stringify(`${manifest.name}/settings`)};

const source: LayeredSettingsSource<{ enabled: boolean }> = {
  agentDir: ".",
  cwd: ".",
  filename: "settings.json",
  sanitize: () => ({}),
  warnLabel: "fixture",
};
void source;
void loadLayeredSettings;
`,
  );
  await writeFile(
    join(installRoot, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2024",
          // The package ships TypeScript source and resolves its own `#src`
          // entries without file extensions, as Pi's loader and bundler-style
          // consumers do.
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          types: ["node"],
        },
        include: ["consumer.ts"],
      },
      null,
      2,
    ),
  );
  await run(
    pnpmCommand,
    ["exec", "tsc", "-p", "tsconfig.json", "--pretty", "false"],
    { cwd: installRoot },
  );

  // The settings utility is the only remaining public entry. Loading it must
  // not expose a runtime handle or require service publication.
  const consumerEntry = join(installRoot, "consumer-extension.ts");
  await writeFile(
    consumerEntry,
    `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadLayeredSettings } from ${JSON.stringify(`${manifest.name}/settings`)};

export default function packedConsumer(_pi: ExtensionAPI): void {
  if (typeof loadLayeredSettings !== "function") {
    throw new Error("packed settings entry did not load");
  }
}
`,
  );

  await writeFile(
    join(installRoot, "loader-check.mjs"),
    `import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

const here = dirname(fileURLToPath(import.meta.url));
const installed = join(here, "node_modules", ${JSON.stringify(manifest.name)});
const packageEntry = join(installed, "extensions", "index.ts");
const require = createRequire(import.meta.url);
for (const specifier of [
  ${JSON.stringify(manifest.name)},
  ${JSON.stringify(`${manifest.name}/src/service/service.ts`)},
]) {
  try {
    require.resolve(specifier);
    throw new Error("removed runtime entry still resolves: " + specifier);
  } catch (error) {
    if (error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
  }
}
const consumerEntry = join(here, "consumer-extension.ts");
const cwd = await mkdtemp(join(tmpdir(), "pi-tiered-packed-project-"));
const agentDir = join(cwd, ".agent");
try {
  const settingsManager = SettingsManager.inMemory();
  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    additionalExtensionPaths: [packageEntry, consumerEntry],
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();
  const errors = resourceLoader.getExtensions().errors;
  if (errors.length > 0) {
    throw new Error("packed extension failed to load: " + JSON.stringify(errors));
  }
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    settingsManager,
    modelRuntime,
    resourceLoader,
    sessionManager: SessionManager.inMemory(cwd),
    noTools: true,
  });
  try {
    await session.bindExtensions({});
    const serviceKey = Symbol.for("@code-fixer-23/pi-tiered-subagents:service");
    if (Object.hasOwn(globalThis, serviceKey)) {
      throw new Error("packed extension published a runtime service");
    }
    const names = session.getAllTools().map((tool) => tool.name);
    for (const name of ["subagent", "get_subagent_result", "steer_subagent"]) {
      if (!names.includes(name)) {
        throw new Error("packed extension did not register tool: " + name);
      }
    }
    console.log("packed extension loaded and bound with tools, without a public runtime");
  } finally {
    session.dispose();
  }
} finally {
  await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
`,
  );
  await run(process.execPath, [join(installRoot, "loader-check.mjs")], {
    cwd: installRoot,
  });
  console.log(
    `release-check: packed install, engine floor, settings types, private runtime boundary, and Pi extension loading passed (node ${process.version})`,
  );
} finally {
  await rm(tempRoot, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
