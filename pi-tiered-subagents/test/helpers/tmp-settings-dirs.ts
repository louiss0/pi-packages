import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  encodeBoolean,
  encodeJson,
  encodeNumber,
  SETTINGS_EXTENSION_NAME,
} from "#src/shared-settings";

/**
 * The shared store's shape for a settings object.
 *
 * The store holds strings, keyed by the extension's name and then by the
 * setting: `{ "<extension>": { "<setting>": "<text>" } }`. The text is the
 * one the adapter writes, so a fixture and the package agree on it.
 */
export function toSharedStore(
  settings: Record<string, unknown>,
): Record<string, Record<string, string>> {
  const values: Record<string, string> = {};
  for (const [id, value] of Object.entries(settings)) {
    if (value === undefined) continue;
    if (typeof value === "string") values[id] = value;
    else if (typeof value === "number") values[id] = encodeNumber(value);
    else if (typeof value === "boolean") values[id] = encodeBoolean(value);
    else values[id] = encodeJson(value);
  }
  return { [SETTINGS_EXTENSION_NAME]: values };
}

/**
 * Shared filesystem fixture for the two-layer (global + project) settings tests.
 *
 * Creates two tmp directories — a global scope (passed as `agentDir`) and a
 * project scope (passed as `cwd`) — and exposes write helpers that land JSON at
 * the global file (`<globalDir>/<filename>`) and the project file
 * (`<projectDir>/.pi/<filename>`). Call `dispose()` in `afterEach`.
 */
export interface SettingsDirs {
  /** Global scope — pass as `agentDir`. */
  globalDir: string;
  /** Project scope — pass as `cwd`. */
  projectDir: string;
  /** Absolute path to the global settings file. */
  globalFile: () => string;
  /** Absolute path to the project settings file (`<projectDir>/.pi/<filename>`). */
  projectFile: () => string;
  /** Write `obj` as JSON to the global file. */
  writeGlobal: (obj: unknown) => void;
  /** Write `obj` as JSON to the project file, creating `<projectDir>/.pi/` first. */
  writeProject: (obj: unknown) => void;
  /** Remove both tmp directories. */
  dispose: () => void;
}

/**
 * The shared store's two scopes, for the settings tests.
 *
 * The same directories as `createSettingsDirs`, but the writers land the
 * shared store's shape: the settings under this package's name, each value
 * as text.
 */
export function createSharedSettingsDirs(): SettingsDirs {
  const dirs = createSettingsDirs("settings-extensions.json");
  return {
    ...dirs,
    writeGlobal(obj: unknown) {
      dirs.writeGlobal(toSharedStore(obj as Record<string, unknown>));
    },
    writeProject(obj: unknown) {
      dirs.writeProject(toSharedStore(obj as Record<string, unknown>));
    },
  };
}

/** Stand up the global + project tmp directories for a settings file named `filename`. */
export function createSettingsDirs(filename: string): SettingsDirs {
  const globalDir = mkdtempSync(join(tmpdir(), "pi-settings-global-"));
  const projectDir = mkdtempSync(join(tmpdir(), "pi-settings-project-"));
  const globalFile = () => join(globalDir, filename);
  const projectFile = () => join(projectDir, ".pi", filename);
  return {
    globalDir,
    projectDir,
    globalFile,
    projectFile,
    writeGlobal(obj: unknown) {
      writeFileSync(globalFile(), JSON.stringify(obj));
    },
    writeProject(obj: unknown) {
      mkdirSync(join(projectDir, ".pi"), { recursive: true });
      writeFileSync(projectFile(), JSON.stringify(obj));
    },
    dispose() {
      rmSync(globalDir, { recursive: true, force: true });
      rmSync(projectDir, { recursive: true, force: true });
    },
  };
}
