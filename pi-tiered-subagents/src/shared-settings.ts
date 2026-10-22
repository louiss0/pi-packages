/**
 * shared.ts — The settings backend this package shares with other extensions.
 *
 * `@juanibiapina/pi-extension-settings` keeps one file of string-valued
 * settings, in two scopes: the operator's global file
 * (`<agentDir>/settings-extensions.json`) and the project's local file
 * (`<cwd>/.pi/settings-extensions.json`). This package keeps its settings
 * there rather than in a file of its own, so one place holds the settings of
 * every extension that uses the shared backend.
 *
 * The store holds strings, so the settings that carry structure — the family
 * profiles, the excluded packages, the prompt-inheritance map — are
 * serialized here and nowhere else. Everything above this module speaks in
 * the package's own vocabulary.
 *
 * The two scopes are read separately rather than through the store's
 * "local, then global" convenience, because the family profiles merge *per
 * family*: a project replaces one family and leaves the operator's others
 * alone.
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

/** Which file of the shared store a setting lives in. */
export type SharedScope = "global" | "local";

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
    defaultValue: "4",
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
    defaultValue: "2",
  },
  {
    id: "consumedSessionRetentionMinutes",
    label: "Consumed session retention (minutes)",
    description: "How long a collected child's session is kept.",
    defaultValue: "10",
  },
  {
    id: "unconsumedSessionRetentionMinutes",
    label: "Unconsumed session retention (minutes)",
    description: "How long an uncollected child's session is kept.",
    defaultValue: "720",
  },
  {
    id: "abortAllOnInterrupt",
    label: "Abort all on interrupt",
    description: "Whether ESC stops every child.",
    defaultValue: "true",
    values: ["true", "false"],
  },
  {
    id: "midRunUpdates",
    label: "Mid-run updates",
    description: "Whether a background child may interrupt the parent.",
    defaultValue: "true",
    values: ["true", "false"],
  },
];
