// Persistence for pi-subagents operational settings.
//
// The settings live in the shared store (`@juanibiapina/pi-extension-settings`),
// in two files: the operator's global file and the project's local file. Both
// are read on their own; only the project's file is ever written.

import { isBelowMinimumTurns, MIN_MAX_TURNS } from "#src/lifecycle/turn-limits";
import {
  BOOLEAN_SETTING_IDS,
  DEFAULT_ABORT_ALL_ON_INTERRUPT,
  DEFAULT_CONSUMED_RETENTION_MINUTES,
  DEFAULT_MAX_CONCURRENT,
  DEFAULT_MID_RUN_UPDATES,
  DEFAULT_UNCONSUMED_RETENTION_MINUTES,
  DEFAULT_WRAP_UP_TURNS,
  JSON_SETTING_IDS,
  NUMBER_SETTING_IDS,
  readBoolean,
  readJson,
  readNumber,
  readSetting,
  RETIRED_SETTING_ID,
  type SharedScope,
  type SharedScopes,
  writeBoolean,
  writeJson,
  writeNumber,
} from "#src/shared-settings";
import type { PromptInheritance } from "#src/types";
export interface SubagentsSettings {
  maxConcurrent?: number;
  /**
   * 0 = unlimited — the extension's single source of truth for that convention:
   * `normalizeMaxTurns()` in turn-limits.ts treats 0 → `undefined`, and the
   * `/agents` → Settings input prompt explicitly says "0 = unlimited".
   */
  defaultMaxTurns?: number;
  /** Turns left when a subagent is warned about its budget. */
  wrapUpTurns?: number;
  /**
   * Load-only marker: a settings file still names the removed `graceTurns`.
   * `load()` warns and strips it, so it is never applied, emitted, or saved.
   */
  legacyGraceTurns?: true;
  /** Minutes a consumed agent's session is retained after its last relevance event. */
  consumedSessionRetentionMinutes?: number;
  /** Minutes an unconsumed agent's session is retained (safety cap). */
  unconsumedSessionRetentionMinutes?: number;
  /**
   * When false, a parent interrupt (ESC) leaves background and queued subagents
   * running. Foreground agents hold the parent's run signal directly, so they
   * abort on ESC either way.
   */
  abortAllOnInterrupt?: boolean;
  /**
   * When false, a background child is not given the `notify_parent` tool, so it
   * cannot interrupt the parent with a mid-run finding. Ask-back is unaffected.
   */
  midRunUpdates?: boolean;
  /**
   * Pi package sources whose extensions child sessions must not load, matched
   * against Pi's configured source string exactly (e.g. `npm:@scope/pkg`).
   * The package's skills, prompts, and themes stay available to children.
   */
  excludedExtensionPackages?: string[];
  /**
   * Prompt-inheritance strategy per provider, keyed by the provider id of the
   * child's resolved model. Every provider not listed inherits `"full"`.
   * The key is the provider rather than the agent because re-homing is a
   * property of the transport, and a per-spawn `model` override moves a child
   * between transports (ADR 0009).
   */
  promptInheritance?: Record<string, PromptInheritance>;
  /**
   * The family profiles in force, keyed by family: the operator's, with the
   * project's replacing one family whole.
   *
   * The values are data the model domain reads and validates; this module only
   * carries them, so that saving the settings does not erase them.
   */
  familyProfiles?: Record<string, unknown>;
}

/**
 * The values a save writes into the project's file.
 *
 * The settings the operator edits are the effective ones, so the project's
 * file says what the operator last chose. The three data settings are the
 * project's own values, and are present only when the project's file
 * declares them: the key has no `/subagents:settings` affordance, so a
 * hand-edited value must round-trip, and the operator's own value must not
 * be copied into the project's file.
 */
export interface SettingsSnapshot {
  maxConcurrent: number;
  defaultMaxTurns: number;
  wrapUpTurns: number;
  consumedSessionRetentionMinutes: number;
  unconsumedSessionRetentionMinutes: number;
  abortAllOnInterrupt: boolean;
  midRunUpdates: boolean;
  /**
   * The packages the project's file excludes, when it declares them. It must
   * round-trip: a hand-edited value would otherwise be erased by any
   * unrelated setting change.
   */
  excludedExtensionPackages?: string[];
  /** The project's own inheritance rules, round-tripped for the same reason. */
  promptInheritance?: Record<string, PromptInheritance>;
  /**
   * The family profiles the project's file declares, round-tripped for the
   * same reason: the settings file is the one place they live, so a
   * `/subagents:settings` edit must not erase them.
   */
  familyProfiles?: Record<string, unknown>;
}

/** Emit callback — a subset of `pi.events.emit` to keep helpers testable. */
export type SettingsEmit = (event: string, payload: unknown) => void;

/**
 * Owns all three in-memory settings values and their load/save/persist cycle.
 * Replaces the scattered free-function + SettingsAppliers callback pattern.
 */
export class SettingsManager {
  private _defaultMaxTurns: number | undefined = undefined;
  private _wrapUpTurns: number = DEFAULT_WRAP_UP_TURNS;
  private _maxConcurrent: number = DEFAULT_MAX_CONCURRENT;
  private _consumedSessionRetentionMinutes: number =
    DEFAULT_CONSUMED_RETENTION_MINUTES;
  private _unconsumedSessionRetentionMinutes: number =
    DEFAULT_UNCONSUMED_RETENTION_MINUTES;
  private _abortAllOnInterrupt: boolean = DEFAULT_ABORT_ALL_ON_INTERRUPT;
  private _midRunUpdates: boolean = DEFAULT_MID_RUN_UPDATES;
  private _excludedExtensionPackages: string[] = [];
  private _promptInheritance: Record<string, PromptInheritance> = {};
  private _familyProfiles: Record<string, unknown> | undefined = undefined;
  /**
   * The values the project's own file declares.
   *
   * A save writes these back, not the merged set: the operator's data
   * belongs to the operator's file, and copying it into the project's file
   * would make it outlive a later change to the operator's own settings.
   */
  private _projectSettings: SubagentsSettings = {};

  private readonly emit: SettingsEmit;
  private readonly cwd: string;
  private readonly agentDir: string;
  private readonly onMaxConcurrentChanged: (() => void) | undefined;

  constructor(deps: {
    emit: SettingsEmit;
    cwd: string;
    agentDir: string;
    onMaxConcurrentChanged?: () => void;
  }) {
    this.emit = deps.emit;
    this.cwd = deps.cwd;
    this.agentDir = deps.agentDir;
    this.onMaxConcurrentChanged = deps.onMaxConcurrentChanged;
  }

  // ── defaultMaxTurns: 0 or undefined → unlimited (undefined); else at least MIN_MAX_TURNS ──

  get defaultMaxTurns(): number | undefined {
    return this._defaultMaxTurns;
  }

  set defaultMaxTurns(n: number | undefined) {
    if (n == null || n === 0) {
      this._defaultMaxTurns = undefined;
    } else {
      this._defaultMaxTurns = Math.max(MIN_MAX_TURNS, n);
    }
  }

  // ── wrapUpTurns: minimum 1 ──

  get wrapUpTurns(): number {
    return this._wrapUpTurns;
  }

  set wrapUpTurns(n: number) {
    this._wrapUpTurns = Math.max(1, n);
  }

  // ── maxConcurrent: minimum 1 ──

  get maxConcurrent(): number {
    return this._maxConcurrent;
  }

  set maxConcurrent(n: number) {
    this._maxConcurrent = Math.max(1, n);
  }

  // ── retention windows: clamped to [1, RETENTION_MINUTES_CEILING] minutes ──

  get consumedSessionRetentionMinutes(): number {
    return this._consumedSessionRetentionMinutes;
  }

  set consumedSessionRetentionMinutes(n: number) {
    this._consumedSessionRetentionMinutes = clampRetentionMinutes(n);
  }

  get unconsumedSessionRetentionMinutes(): number {
    return this._unconsumedSessionRetentionMinutes;
  }

  set unconsumedSessionRetentionMinutes(n: number) {
    this._unconsumedSessionRetentionMinutes = clampRetentionMinutes(n);
  }

  // ── abortAllOnInterrupt: flipped via toggleAbortAllOnInterrupt(); no normalization ──

  get abortAllOnInterrupt(): boolean {
    return this._abortAllOnInterrupt;
  }

  // ── excludedExtensionPackages: hand-edited only; no /subagents:settings affordance ──

  get excludedExtensionPackages(): readonly string[] {
    return this._excludedExtensionPackages;
  }

  // ── promptInheritance: hand-edited only; no /subagents:settings affordance ──

  /**
   * The prompt-inheritance strategy a child on `provider` adopts.
   *
   * Unlisted providers, and a child that resolved no model at all, inherit
   * `"full"` — the default, which changes no existing child's prompt.
   */
  promptInheritanceFor(provider: string | undefined): PromptInheritance {
    if (provider === undefined) return "full";
    return this._promptInheritance[provider] ?? "full";
  }

  // ── Lifecycle methods ──

  /**
   * Load merged settings (global + project), apply to in-memory values,
   * and emit the `subagents:settings_loaded` lifecycle event.
   * Returns the raw loaded settings object.
   *
   * Both layers are read here, while the extension runs. Whether a project's
   * files may be used is Pi's decision about its own resources; this package
   * adds no second trust gate (ARCHITECTURE-SPEC story 36).
   */
  load(): SubagentsSettings {
    const { settings, projectSettings } = loadSettingsLayers(
      this.agentDir,
      this.cwd,
    );
    const { legacyGraceTurns, ...loaded } = settings;
    warnAboutRetiredSettings(loaded, legacyGraceTurns === true);
    if (typeof settings.maxConcurrent === "number")
      this.maxConcurrent = settings.maxConcurrent;
    if (typeof settings.defaultMaxTurns === "number")
      this.defaultMaxTurns = settings.defaultMaxTurns;
    if (typeof settings.wrapUpTurns === "number")
      this.wrapUpTurns = settings.wrapUpTurns;
    if (typeof settings.consumedSessionRetentionMinutes === "number")
      this.consumedSessionRetentionMinutes =
        settings.consumedSessionRetentionMinutes;
    if (typeof settings.unconsumedSessionRetentionMinutes === "number")
      this.unconsumedSessionRetentionMinutes =
        settings.unconsumedSessionRetentionMinutes;
    if (typeof settings.abortAllOnInterrupt === "boolean")
      this._abortAllOnInterrupt = settings.abortAllOnInterrupt;
    if (typeof settings.midRunUpdates === "boolean")
      this._midRunUpdates = settings.midRunUpdates;
    // Assigned unconditionally: removing the key from disk must clear the value.
    this._excludedExtensionPackages = [
      ...(settings.excludedExtensionPackages ?? []),
    ];
    this._promptInheritance = { ...settings.promptInheritance };
    this._familyProfiles = settings.familyProfiles
      ? { ...settings.familyProfiles }
      : undefined;
    this._projectSettings = { ...projectSettings };
    this.emit("subagents:settings_loaded", { settings: loaded });
    return loaded;
  }

  /**
   * The operator's family profiles, as they were loaded.
   *
   * The model domain reads and validates them; this module only carries them.
   */
  get familyProfiles(): Record<string, unknown> | undefined {
    return this._familyProfiles;
  }

  /**
   * Snapshot the values a save writes into the project's file.
   *
   * The settings the operator edits are the effective ones, so the project's
   * file says what the operator last chose. The data the operator hand-edits
   * is the project's own, so the operator's data is never copied into the
   * project's file.
   *
   * `defaultMaxTurns` uses 0 as the on-disk marker for unlimited (undefined).
   */
  snapshot(): SettingsSnapshot {
    const snapshot: SettingsSnapshot = {
      maxConcurrent: this._maxConcurrent,
      defaultMaxTurns: this._defaultMaxTurns ?? 0,
      wrapUpTurns: this._wrapUpTurns,
      consumedSessionRetentionMinutes: this._consumedSessionRetentionMinutes,
      unconsumedSessionRetentionMinutes:
        this._unconsumedSessionRetentionMinutes,
      abortAllOnInterrupt: this._abortAllOnInterrupt,
      midRunUpdates: this._midRunUpdates,
    };
    if (this._projectSettings.excludedExtensionPackages !== undefined) {
      snapshot.excludedExtensionPackages = [
        ...this._projectSettings.excludedExtensionPackages,
      ];
    }
    if (this._projectSettings.promptInheritance !== undefined) {
      snapshot.promptInheritance = {
        ...this._projectSettings.promptInheritance,
      };
    }
    if (this._projectSettings.familyProfiles !== undefined) {
      snapshot.familyProfiles = { ...this._projectSettings.familyProfiles };
    }
    return snapshot;
  }

  /**
   * Set maxConcurrent, notify interested parties, persist, and return the toast.
   * Owns the full consequence chain so callers just say what they want.
   */
  applyMaxConcurrent(n: number): {
    message: string;
    level: "info" | "warning";
  } {
    this.maxConcurrent = n; // setter normalizes: max(1, n)
    this.onMaxConcurrentChanged?.();
    return this.saveAndNotify(`Max concurrency set to ${this.maxConcurrent}`);
  }

  /**
   * Set defaultMaxTurns, persist, and return the toast.
   * Pass 0 for unlimited (maps to undefined internally).
   */
  applyDefaultMaxTurns(n: number): {
    message: string;
    level: "info" | "warning";
  } {
    this.defaultMaxTurns = n === 0 ? undefined : n; // setter normalizes further
    const label =
      this.defaultMaxTurns == null ? "unlimited" : String(this.defaultMaxTurns);
    return this.saveAndNotify(`Default max turns set to ${label}`);
  }

  /**
   * Set wrapUpTurns, persist, and return the toast.
   */
  applyWrapUpTurns(n: number): { message: string; level: "info" | "warning" } {
    this.wrapUpTurns = n; // setter normalizes: max(1, n)
    return this.saveAndNotify(`Wrap-up turns set to ${this.wrapUpTurns}`);
  }

  /** Set the consumed-session retention window (minutes), persist, and return the toast. */
  applyConsumedSessionRetentionMinutes(n: number): {
    message: string;
    level: "info" | "warning";
  } {
    this.consumedSessionRetentionMinutes = n; // setter normalizes: clamp [1, ceiling]
    return this.saveAndNotify(
      `Consumed-session retention set to ${this.consumedSessionRetentionMinutes} min`,
    );
  }

  /** Set the unconsumed-session retention window (minutes), persist, and return the toast. */
  applyUnconsumedSessionRetentionMinutes(n: number): {
    message: string;
    level: "info" | "warning";
  } {
    this.unconsumedSessionRetentionMinutes = n; // setter normalizes: clamp [1, ceiling]
    return this.saveAndNotify(
      `Unconsumed-session retention set to ${this.unconsumedSessionRetentionMinutes} min`,
    );
  }

  /**
   * Flip whether a parent interrupt (ESC) aborts every subagent, persist, and
   * return the toast. The manager owns the negation so callers just say "flip it".
   */
  toggleAbortAllOnInterrupt(): { message: string; level: "info" | "warning" } {
    this._abortAllOnInterrupt = !this._abortAllOnInterrupt;
    return this.saveAndNotify(
      `Abort all subagents on ESC: ${this._abortAllOnInterrupt ? "on" : "off"}`,
    );
  }

  get midRunUpdates(): boolean {
    return this._midRunUpdates;
  }

  /**
   * Flip whether a background child may interrupt the parent with a mid-run
   * update, persist, and return the toast.
   */
  toggleMidRunUpdates(): { message: string; level: "info" | "warning" } {
    this._midRunUpdates = !this._midRunUpdates;
    return this.saveAndNotify(
      `Mid-run updates from background subagents: ${this._midRunUpdates ? "on" : "off"}`,
    );
  }

  /**
   * Persist the current snapshot, emit `subagents:settings_changed`,
   * and return the toast the UI should display.
   */
  saveAndNotify(successMsg: string): {
    message: string;
    level: "info" | "warning";
  } {
    const snap = this.snapshot();
    const persisted = saveSettings(snap, this.cwd);
    this.emit("subagents:settings_changed", { settings: snap, persisted });
    return persistToastFor(successMsg, persisted);
  }
}

// Sanity ceilings — prevent hand-edited configs from asking for values that
// make no operational sense (e.g. 1e6 concurrent subagents). Permissive enough
// that any realistic power-user setting passes through.
const MAX_CONCURRENT_CEILING = 1024;
const MAX_TURNS_CEILING = 10_000;
const WRAP_UP_TURNS_CEILING = 1_000;
// Retention windows: 1 minute floor, two-week ceiling (60 * 24 * 14).
const RETENTION_MINUTES_CEILING = 20_160;

/** Clamp a retention window to [1, RETENTION_MINUTES_CEILING] minutes. */
function clampRetentionMinutes(n: number): number {
  return Math.min(RETENTION_MINUTES_CEILING, Math.max(1, n));
}

/** True when a value is an integer minute count within the accepted retention range. */
function isRetentionMinutes(n: unknown): n is number {
  return (
    Number.isInteger(n) &&
    (n as number) >= 1 &&
    (n as number) <= RETENTION_MINUTES_CEILING
  );
}

/**
 * Tell the operator about settings this version reads differently, so a value
 * that stopped meaning what they wrote does not change behavior silently.
 */
function warnAboutRetiredSettings(
  settings: SubagentsSettings,
  hasGraceTurns: boolean,
): void {
  if (hasGraceTurns) {
    console.warn(
      `[pi-subagents] graceTurns was removed; set wrapUpTurns (turns left when a subagent is warned, default ${DEFAULT_WRAP_UP_TURNS}) instead.`,
    );
  }
  if (isBelowMinimumTurns(settings.defaultMaxTurns)) {
    console.warn(
      `[pi-subagents] defaultMaxTurns ${settings.defaultMaxTurns} is below the minimum of ${MIN_MAX_TURNS}; using ${MIN_MAX_TURNS}.`,
    );
  }
}

/** Drop fields that don't match the expected shape. Silent — garbage becomes absent. */
function sanitize(raw: unknown): SubagentsSettings {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: SubagentsSettings = {};
  if (
    Number.isInteger(r.maxConcurrent) &&
    (r.maxConcurrent as number) >= 1 &&
    (r.maxConcurrent as number) <= MAX_CONCURRENT_CEILING
  ) {
    out.maxConcurrent = r.maxConcurrent as number;
  }
  if (
    Number.isInteger(r.defaultMaxTurns) &&
    (r.defaultMaxTurns as number) >= 0 &&
    (r.defaultMaxTurns as number) <= MAX_TURNS_CEILING
  ) {
    out.defaultMaxTurns = r.defaultMaxTurns as number;
  }
  if (
    Number.isInteger(r.wrapUpTurns) &&
    (r.wrapUpTurns as number) >= 1 &&
    (r.wrapUpTurns as number) <= WRAP_UP_TURNS_CEILING
  ) {
    out.wrapUpTurns = r.wrapUpTurns as number;
  }
  if ("graceTurns" in r) {
    out.legacyGraceTurns = true;
  }
  if (isRetentionMinutes(r.consumedSessionRetentionMinutes)) {
    out.consumedSessionRetentionMinutes = r.consumedSessionRetentionMinutes;
  }
  if (isRetentionMinutes(r.unconsumedSessionRetentionMinutes)) {
    out.unconsumedSessionRetentionMinutes = r.unconsumedSessionRetentionMinutes;
  }
  if (typeof r.abortAllOnInterrupt === "boolean") {
    out.abortAllOnInterrupt = r.abortAllOnInterrupt;
  }
  if (typeof r.midRunUpdates === "boolean") {
    out.midRunUpdates = r.midRunUpdates;
  }
  if (Array.isArray(r.excludedExtensionPackages)) {
    const sources = r.excludedExtensionPackages
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean);
    out.excludedExtensionPackages = [...new Set(sources)];
  }
  const promptInheritance = sanitizePromptInheritance(r.promptInheritance);
  if (promptInheritance) {
    out.promptInheritance = promptInheritance;
  }
  // The family profiles are data the model domain reads, not settings this
  // module interprets. They are kept as they were written, so that saving the
  // settings does not erase them.
  if (r.familyProfiles && typeof r.familyProfiles === "object") {
    out.familyProfiles = r.familyProfiles as Record<string, unknown>;
  }
  return out;
}

/**
 * Keep only provider entries naming a known strategy, absent when none survive.
 *
 * Settings arrive from JSON, where the declared types are aspirations, so the
 * strategy is checked at run time rather than trusted.
 */
function sanitizePromptInheritance(
  raw: unknown,
): Record<string, PromptInheritance> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const rules: Record<string, PromptInheritance> = {};
  for (const [provider, strategy] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    if (strategy === "full" || strategy === "portable") {
      rules[provider] = strategy;
    }
  }
  return Object.keys(rules).length > 0 ? rules : undefined;
}

/** Read one scope of the shared store as the settings it holds. */
function readScope(
  scope: SharedScope,
  scopes: SharedScopes,
): SubagentsSettings {
  const raw: Record<string, unknown> = {};
  for (const id of NUMBER_SETTING_IDS) {
    const value = readNumber(id, scope, scopes);
    if (value !== undefined) raw[id] = value;
  }
  for (const id of BOOLEAN_SETTING_IDS) {
    const value = readBoolean(id, scope, scopes);
    if (value !== undefined) raw[id] = value;
  }
  for (const id of JSON_SETTING_IDS) {
    const value = readJson(id, scope, scopes);
    if (value !== undefined) raw[id] = value;
  }
  // A setting this version no longer reads is still worth naming: the
  // operator is told what to use instead.
  if (readSetting(RETIRED_SETTING_ID, scope, scopes) !== undefined) {
    raw[RETIRED_SETTING_ID] = true;
  }
  return sanitize(raw);
}

/** Merge the two scopes: the project's values win, the operator's fill the rest. */
function mergeScopes(
  global: SubagentsSettings,
  project: SubagentsSettings,
): SubagentsSettings {
  return {
    ...global,
    ...project,
    ...(global.familyProfiles || project.familyProfiles
      ? {
          familyProfiles: {
            ...global.familyProfiles,
            ...project.familyProfiles,
          },
        }
      : {}),
  };
}

/**
 * Load the settings: the operator's global scope, then the project's.
 *
 * The family profiles merge per family rather than per scope, so a project
 * refines one family without erasing the operator's others.
 */
export function loadSettings(agentDir: string, cwd: string): SubagentsSettings {
  return loadSettingsLayers(agentDir, cwd).settings;
}

/** What one load found: the merged settings, and the project's own layer. */
export interface LoadedSettings {
  /** The merged settings: the project's values over the operator's. */
  readonly settings: SubagentsSettings;
  /**
   * The values the project's own file declares.
   *
   * These are the values a save writes back: the merged set would carry the
   * operator's data into the project's file, where it would outlive a later
   * change to the operator's own settings.
   */
  readonly projectSettings: SubagentsSettings;
}

/** Read both scopes once, and report what each of them held. */
export function loadSettingsLayers(
  agentDir: string,
  cwd: string,
): LoadedSettings {
  const scopes: SharedScopes = { agentDir, cwd };
  const global = readScope("global", scopes);
  const project = readScope("project", scopes);
  return {
    settings: mergeScopes(global, project),
    projectSettings: project,
  };
}

/**
 * Write the project's layer of the settings. The operator's global file is
 * never touched from code.
 *
 * The values written are the project's own: the settings the operator edits
 * through `/subagents:settings`, and the data the operator hand-edits in the
 * project's file. A value the project's file does not declare is not written
 * at all, so the operator's own data is never copied into the project's file
 * — where it would outlive a later change to the operator's settings.
 *
 * Returns `true` on success, `false` if the write failed so the caller can
 * surface a warning — persistence isn't fatal but isn't silent.
 */
export function saveSettings(
  s: SubagentsSettings,
  cwd: string = process.cwd(),
): boolean {
  try {
    for (const id of NUMBER_SETTING_IDS) {
      const value = s[id];
      if (value === undefined) continue;
      writeNumber(id, value, cwd);
    }
    for (const id of BOOLEAN_SETTING_IDS) {
      const value = s[id];
      if (value === undefined) continue;
      writeBoolean(id, value, cwd);
    }
    // The data settings are written only when the project's file declares
    // them: the store keeps what it was given, so a setting that is written
    // as an empty value clears the operator's, and a setting that is not
    // written leaves the operator's own value in force.
    for (const id of JSON_SETTING_IDS) {
      const value = s[id];
      if (value === undefined) continue;
      writeJson(id, value, cwd);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Format the user-facing toast for a settings mutation. Pure function —
 * routes the success/failure of `saveSettings` into the right message + level
 * so the UI layer (index.ts) stays a thin wire between input and notification.
 */
export function persistToastFor(
  successMsg: string,
  persisted: boolean,
): { message: string; level: "info" | "warning" } {
  return persisted
    ? { message: successMsg, level: "info" }
    : {
        message: `${successMsg} (session only; failed to persist)`,
        level: "warning",
      };
}
