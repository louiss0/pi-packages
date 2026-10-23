/**
 * UI-owned, by-value presentation contracts. Runtime adapters supply these
 * views; terminal components never receive a live child or execution manager.
 */

/** A model as the UI names it, without an SDK model or provider registry. */
export interface ModelIdentity {
  readonly provider: string;
  readonly id: string;
}

/** Only the definition fields needed to label an agent. */
export interface AgentDefinitionView {
  readonly id: string;
  readonly displayName: string;
}

/** Label lookup, not definition selection or launch policy. */
export interface AgentDefinitionLookup {
  find(id: string): AgentDefinitionView | undefined;
}

/** Recorded turn-budget facts, not a turn-limit policy or tracker. */
export interface TurnBudget {
  readonly maxTurns?: number;
  readonly used: number;
  readonly phase: "within" | "warned" | "exhausted";
}

/** Lifetime token components, excluding repeatedly-read cache tokens. */
export interface LifetimeUsage {
  readonly input: number;
  readonly output: number;
  readonly cacheWrite: number;
}

export type AgentStatus =
  | "queued"
  | "running"
  | "completed"
  | "aborted"
  | "stopped"
  | "error";

/** Minimal agent snapshot for rendering — no class methods or mutation surface. */
export interface WidgetAgent {
  readonly id: string;
  readonly type: string;
  readonly status: AgentStatus;
  readonly description: string;
  readonly toolUses: number;
  readonly startedAt: number;
  readonly completedAt?: number | undefined;
  readonly error?: string | undefined;
  readonly lifetimeUsage?: LifetimeUsage | undefined;
  readonly compactionCount: number;
  /** The run's recorded budget; absent until its turn loop starts. */
  readonly turnBudget?: TurnBudget | undefined;
  readonly activeTools: ReadonlyMap<string, string>;
  readonly responseText: string;
  /** Context-window utilisation (0–100), or null when unavailable. */
  readonly contextPercent: number | null;
  /** The model the agent runs, once known. */
  readonly model?: ModelIdentity | undefined;
}

/** The widget's audience, already filtered and copied by its runtime adapter. */
export interface WidgetSource {
  listAgents(): readonly WidgetAgent[];
}

/** Identity-only lifecycle notifications keep widget observers structural. */
export interface WidgetAgentIdentity {
  readonly id: string;
}

/** Resolved launch facts that terminal tags name; no resolver dependency. */
export interface InvocationTags {
  readonly thinking?: string;
  readonly maxTurns?: number;
  readonly inheritContext: boolean;
  readonly runInBackground: boolean;
}
