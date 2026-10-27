/**
 * UI-owned, by-value presentation contracts. Runtime adapters supply these
 * views; terminal components never receive a live child or execution manager.
 */

/** A model as the UI names it, without an SDK model or provider registry. */
export type ModelIdentity = Readonly<{
  provider: string;
  id: string;
}>;

/** Only the definition fields needed to label an agent. */
export type AgentDefinitionView = Readonly<{
  id: string;
  displayName: string;
}>;

/** Label lookup, not definition selection or launch policy. */
export interface AgentDefinitionLookup {
  find(id: string): AgentDefinitionView | undefined;
}

/** Recorded turn-budget facts, not a turn-limit policy or tracker. */
export type TurnBudget = Readonly<{
  maxTurns?: number;
  used: number;
  phase: "within" | "warned" | "exhausted";
}>;

/** Lifetime token components, excluding repeatedly-read cache tokens. */
export type LifetimeUsage = Readonly<{
  input: number;
  output: number;
  cacheWrite: number;
}>;

export type AgentStatus =
  | "queued"
  | "running"
  | "completed"
  | "aborted"
  | "stopped"
  | "error";

/** Minimal agent snapshot for rendering — no class methods or mutation surface. */
export type WidgetAgent = Readonly<{
  id: string;
  type: string;
  status: AgentStatus;
  description: string;
  toolUses: number;
  startedAt: number;
  completedAt?: number | undefined;
  error?: string | undefined;
  lifetimeUsage?: LifetimeUsage | undefined;
  compactionCount: number;
  /** The run's recorded budget; absent until its turn loop starts. */
  turnBudget?: TurnBudget | undefined;
  activeTools: ReadonlyMap<string, string>;
  responseText: string;
  /** Context-window utilisation (0–100), or null when unavailable. */
  contextPercent: number | null;
  /** The model the agent runs, once known. */
  model?: ModelIdentity | undefined;
}>;

/** The widget's audience, already filtered and copied by its runtime adapter. */
export interface WidgetSource {
  listAgents(): ReadonlyArray<WidgetAgent>;
}

/** Identity-only lifecycle notifications keep widget observers structural. */
export type WidgetAgentIdentity = Readonly<{
  id: string;
}>;

/** Resolved launch facts that terminal tags name; no resolver dependency. */
export type InvocationTags = Readonly<{
  thinking?: string;
  maxTurns?: number;
  inheritContext: boolean;
  runInBackground: boolean;
}>;
