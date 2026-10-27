/**
 * shared-settings.ts — The settings backend this package shares with other
 * extensions.
 *
 * `@juanibiapina/pi-extension-settings` keeps one file of string-valued
 * settings, in two files: the operator's global file
 * (`<agentDir>/settings-extensions.json`) and the project's local file
 * (`<cwd>/.pi/settings-extensions.json`). This package keeps its settings
 * there rather than in a file of its own, so one place holds the settings of
 * every extension that uses the shared backend.
 *
 * The store holds strings, so this module is the one place that serializes:
 * the settings that carry structure — the family profiles, the excluded
 * packages, the prompt-inheritance map — are JSON here, and nothing above
 * this module knows that.
 *
 * **The two files are read on their own.** The store's *local* scope reads
 * the project's file and falls back to the operator's file, per setting, so
 * it cannot answer "what did the project declare for itself?". The project's
 * read therefore points the operator's directory at a path that holds no
 * store file, and the read stops at the project's file.
 *
 * **Only the project's file is written.** The operator's file is the
 * operator's own; nothing in this package changes it.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getSetting,
  setSetting,
  type SettingDefinition,
  type SettingStorageOptions,
} from "@juanibiapina/pi-extension-settings";
// The wrap-up default is the turn policy's own: the resolver falls back to the
// same number when no layer names one, so the menu advertises a single value.
import { DEFAULT_WRAP_UP_TURNS } from "#src/lifecycle/turn-limits";

/**
 * The name this package's settings live under in the shared store.
 *
 * The store keys every extension's settings by name, so this is what keeps
 * this package's settings apart from everyone else's.
 */
export const SETTINGS_EXTENSION_NAME = "pi-tiered-subagents";

/** The scopes the shared store reads and writes. */
export type SharedScopes = Readonly<{
  /** The operator's global directory — Pi's agent directory. */
  agentDir: string;
  /** The project directory — the project's file. */
  cwd: string;
}>;

/**
 * Which file of the shared store a setting is read from.
 *
 * `global` is the operator's file alone. `project` is the project's file
 * alone: the store's own project scope would fall back to the operator's
 * file, and a reader has to be able to tell the two files apart.
 */
export type SharedScope = "global" | "project";

/**
 * A directory that holds no shared-store file.
 *
 * The store's project scope reads the project's file and falls back to the
 * operator's file, per setting. That fallback hides whether the project
 * declared a setting for itself, so the project's read points the operator's
 * directory here instead: a path that holds no store file, so the fallback
 * finds nothing and the read stops at the project's file.
 *
 * The path is under the temporary directory, so a project cannot put a file
 * there, and this package never creates it.
 */
const NO_OPERATOR_FILE = join(tmpdir(), "pi-tiered-subagents-no-operator-file");

/**
 * The store's own options for one of this package's scopes.
 *
 * The store's `global` scope is the operator's file alone. Its `local` scope
 * is the project's file with the operator's file as its fallback, so the
 * operator's directory is pointed at a path that holds no store file: the
 * read then stops at the project's file, and the two scopes answer
 * separately.
 */
function storeOptions(
  scope: SharedScope,
  scopes: SharedScopes,
): SettingStorageOptions {
  if (scope === "global") {
    return { scope: "global", agentDir: scopes.agentDir };
  }
  return {
    scope: "local",
    cwd: scopes.cwd,
    agentDir: NO_OPERATOR_FILE,
  };
}

/** The settings that hold a number. */
export const NUMBER_SETTING_IDS = [
  "maxConcurrent",
  "defaultMaxTurns",
  "wrapUpTurns",
  "consumedSessionRetentionMinutes",
  "unconsumedSessionRetentionMinutes",
] as const;

/** The settings that hold a yes-or-no answer. */
export const BOOLEAN_SETTING_IDS = [
  "abortAllOnInterrupt",
  "midRunUpdates",
] as const;

/** The settings that carry structure, and are therefore stored as JSON text. */
export const JSON_SETTING_IDS = [
  "excludedExtensionPackages",
  "promptInheritance",
  "familyProfiles",
] as const;

/** The setting this version no longer reads, named so the operator can be told. */
export const RETIRED_SETTING_ID = "graceTurns";

/** The defaults the shipped settings start from. */
export const DEFAULT_MAX_CONCURRENT = 4;
export const DEFAULT_CONSUMED_RETENTION_MINUTES = 10;
export const DEFAULT_UNCONSUMED_RETENTION_MINUTES = 720;
export const DEFAULT_ABORT_ALL_ON_INTERRUPT = true;
export const DEFAULT_MID_RUN_UPDATES = true;

/**
 * Read one setting from one scope.
 *
 * Returns undefined when the scope holds nothing for it: the caller decides
 * what an absent setting means, because "not set" and "set to the default"
 * are different answers for some settings.
 */
export function readSetting(
  id: string,
  scope: SharedScope,
  scopes: SharedScopes,
): string | undefined {
  try {
    return getSetting(
      SETTINGS_EXTENSION_NAME,
      id,
      undefined,
      storeOptions(scope, scopes),
    );
  } catch {
    // The store reads the file it owns; a file it cannot read — one the
    // process has no permission for — makes it fail. A setting that cannot
    // be read is a setting that is not set — the same answer a missing file
    // gives.
    return undefined;
  }
}

/**
 * Write one setting into the project's file.
 *
 * The store rewrites the file it owns, keeping the settings of the other
 * extensions and the other settings of this one. The operator's file is
 * never written: the operator's settings are the operator's own.
 */
export function writeSetting(id: string, value: string, cwd: string): void {
  setSetting(SETTINGS_EXTENSION_NAME, id, value, { scope: "local", cwd });
}

/** Read a number. A value that is not a number is no value. */
export function readNumber(
  id: string,
  scope: SharedScope,
  scopes: SharedScopes,
): number | undefined {
  const text = readSetting(id, scope, scopes);
  if (text === undefined) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/** Read a yes-or-no answer. A value that is neither is no value. */
export function readBoolean(
  id: string,
  scope: SharedScope,
  scopes: SharedScopes,
): boolean | undefined {
  const text = readSetting(id, scope, scopes);
  if (text === "true") return true;
  if (text === "false") return false;
  return undefined;
}

/** Read a value that carries structure. A value that is not JSON is no value. */
export function readJson(
  id: string,
  scope: SharedScope,
  scopes: SharedScopes,
): unknown {
  const text = readSetting(id, scope, scopes);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The text the store holds a number as. */
export function encodeNumber(value: number): string {
  return String(value);
}

/** The text the store holds a yes-or-no answer as. */
export function encodeBoolean(value: boolean): string {
  return value ? "true" : "false";
}

/** The text the store holds a value that carries structure as. */
export function encodeJson(value: unknown): string {
  return JSON.stringify(value);
}

/** Write a number as its text. */
export function writeNumber(id: string, value: number, cwd: string): void {
  writeSetting(id, encodeNumber(value), cwd);
}

/** Write a yes-or-no answer as its text. */
export function writeBoolean(id: string, value: boolean, cwd: string): void {
  writeSetting(id, encodeBoolean(value), cwd);
}

/** Write a value that carries structure as JSON text. */
export function writeJson(id: string, value: unknown, cwd: string): void {
  writeSetting(id, encodeJson(value), cwd);
}

/**
 * The setting definitions this package publishes to the shared settings UI.
 *
 * The UI lists what it can change; a setting that is not listed is still
 * read and written, it is just not editable there. The family profiles are
 * data rather than a value a menu can offer, so they are not listed.
 */
export const SHARED_SETTING_DEFINITIONS: ReadonlyArray<SettingDefinition> = [
  {
    id: "maxConcurrent",
    label: "Max concurrent subagents",
    description: "How many background children may run at once.",
    defaultValue: String(DEFAULT_MAX_CONCURRENT),
  },
  {
    id: "defaultMaxTurns",
    label: "Default max turns",
    description: "Turn ceiling for a child. 0 means unlimited.",
    defaultValue: "0",
  },
  {
    id: "wrapUpTurns",
    label: "Wrap-up turns",
    description: "Turns left when a child is warned about its budget.",
    defaultValue: String(DEFAULT_WRAP_UP_TURNS),
  },
  {
    id: "consumedSessionRetentionMinutes",
    label: "Consumed session retention (minutes)",
    description: "How long a collected child's session is kept.",
    defaultValue: String(DEFAULT_CONSUMED_RETENTION_MINUTES),
  },
  {
    id: "unconsumedSessionRetentionMinutes",
    label: "Unconsumed session retention (minutes)",
    description: "How long an uncollected child's session is kept.",
    defaultValue: String(DEFAULT_UNCONSUMED_RETENTION_MINUTES),
  },
  {
    id: "abortAllOnInterrupt",
    label: "Abort all on interrupt",
    description: "Whether ESC stops every child.",
    defaultValue: String(DEFAULT_ABORT_ALL_ON_INTERRUPT),
    values: ["true", "false"],
  },
  {
    id: "midRunUpdates",
    label: "Mid-run updates",
    description: "Whether a background child may interrupt the parent.",
    defaultValue: String(DEFAULT_MID_RUN_UPDATES),
    values: ["true", "false"],
  },
];
