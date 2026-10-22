/**
 * shared-settings.ts — The settings backend this package shares with other
 * extensions.
 *
 * `@juanibiapina/pi-extension-settings` keeps one file of string-valued
 * settings, in two scopes: the operator's global file
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
 * The two scopes are not read separately by the store: its *local* scope
 * reads the project's file and falls back to the operator's file, per
 * setting. The caller therefore compares the two reads when it needs to know
 * what the project declared for itself.
 */

import {
  getSetting,
  setSetting,
  type SettingDefinition,
} from "@juanibiapina/pi-extension-settings";

/**
 * The name this package's settings live under in the shared store.
 *
 * The store keys every extension's settings by name, so this is what keeps
 * this package's settings apart from everyone else's.
 */
export const SETTINGS_EXTENSION_NAME = "pi-tiered-subagents";

/** The scopes the shared store reads and writes. */
export interface SharedScopes {
  /** The operator's global directory — Pi's agent directory. */
  readonly agentDir: string;
  /** The project directory — the local scope. */
  readonly cwd: string;
}

/**
 * Which file of the shared store a setting lives in.
 *
 * `global` is the operator's file alone. `local` is the project's file with
 * the operator's file as its fallback — the store's own layering, per
 * setting.
 */
export type SharedScope = "global" | "local";

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
export const DEFAULT_WRAP_UP_TURNS = 2;
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
    return getSetting(SETTINGS_EXTENSION_NAME, id, undefined, {
      scope,
      cwd: scopes.cwd,
      agentDir: scopes.agentDir,
    });
  } catch {
    // The store reads the file it owns; a file whose root is not an object
    // makes it fail. A setting that cannot be read is a setting that is not
    // set — the same answer a missing file gives.
    return undefined;
  }
}

/**
 * Write one setting into one scope.
 *
 * The store rewrites the file it owns, keeping the settings of the other
 * extensions and the other settings of this one.
 */
export function writeSetting(
  id: string,
  value: string,
  scope: SharedScope,
  scopes: SharedScopes,
): void {
  setSetting(SETTINGS_EXTENSION_NAME, id, value, {
    scope,
    cwd: scopes.cwd,
    agentDir: scopes.agentDir,
  });
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

/** Write a number as its text. */
export function writeNumber(
  id: string,
  value: number,
  scope: SharedScope,
  scopes: SharedScopes,
): void {
  writeSetting(id, String(value), scope, scopes);
}

/** Write a yes-or-no answer as its text. */
export function writeBoolean(
  id: string,
  value: boolean,
  scope: SharedScope,
  scopes: SharedScopes,
): void {
  writeSetting(id, value ? "true" : "false", scope, scopes);
}

/** Write a value that carries structure as JSON text. */
export function writeJson(
  id: string,
  value: unknown,
  scope: SharedScope,
  scopes: SharedScopes,
): void {
  writeSetting(id, JSON.stringify(value), scope, scopes);
}

/**
 * The setting definitions this package publishes to the shared settings UI.
 *
 * The UI lists what it can change; a setting that is not listed is still
 * read and written, it is just not editable there. The family profiles are
 * data rather than a value a menu can offer, so they are not listed.
 */
export const SHARED_SETTING_DEFINITIONS: readonly SettingDefinition[] = [
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
