/**
 * types.ts — Type definitions for the subagent system.
 */

import type { Model } from "@earendil-works/pi-ai";
import type {
  AgentSessionEvent,
  SessionContext as SdkSessionContext,
} from "@earendil-works/pi-coding-agent";
import type { SubagentThinkingLevel } from "#src/config/thinking-level";
import type { ModelRegistry } from "#src/models/registry";

export type { SteerOutcome } from "#src/lifecycle/subagent";
export { Subagent } from "#src/lifecycle/subagent";
export type { AgentSessionEvent };

/**
 * The thinking levels this package accepts.
 *
 * Wider than pi-ai's `ThinkingLevel`, which omits `off` — Pi honors it, and agent
 * frontmatter has always documented it.
 */
export type ThinkingLevel = SubagentThinkingLevel;

/**
 * How a child adopts its parent's prompt as its own identity.
 *
 * `full` embeds the parent's assembled prompt minus Pi's per-session layers —
 * a leading prefix the child shares with its parent (ADR 0006, ADR 0008).
 * `portable` embeds only the parent's operator-authored parts, for a child
 * whose provider re-homes the prompt into another harness that supplies its
 * own base (ADR 0009).
 */
export type PromptInheritance = "full" | "portable";

/**
 * One message in a child session's history, typed from Pi's `SessionContext`.
 *
 * Derived from the barrel-exported `SessionContext` (whose `messages` field is
 * `AgentMessage[]`) so the package needs no direct dependency on
 * `@earendil-works/pi-agent-core`, which is not re-exported from the public barrel.
 */
export type SessionMessage = SdkSessionContext["messages"][number];

/**
 * Narrow session interface for event subscription.
 * Used by record-observer — only the subscribe method is needed.
 */
export interface SubscribableSession {
  subscribe(fn: (event: AgentSessionEvent) => void): () => void;
}

/** Agent type: any string name (shipped specialists or user-defined). */
export type SubagentType = string;

/**
 * Narrow shell-exec callback replacing `ExtensionAPI` in `detectEnv()`.
 * Matches the shape of `pi.exec()` without carrying an SDK dependency.
 */
/**
 * Narrow interface capturing the ExtensionContext fields SubagentRuntime needs.
 * Avoids coupling runtime to the full SDK ExtensionContext surface (ISP).
 */
export interface SessionContext {
  readonly cwd: string;
  readonly model: Model<any> | undefined;
  readonly modelRegistry: ModelRegistry;
  getSystemPrompt(): string;
  /**
   * The effort the session is running at, when the session has one.
   *
   * A child that keeps the parent's model must not work harder than the
   * parent did, so the reasoning fallback reads it.
   */
  readonly thinkingLevel?: ThinkingLevel;
  readonly sessionManager: {
    getSessionFile(): string | undefined;
    getSessionId(): string;
    getBranch(): unknown[];
  };
}

/**
 * Narrow shell-exec callback replacing `ExtensionAPI` in `detectEnv()`.
 * Matches the shape of `pi.exec()` without carrying an SDK dependency.
 */
export type ShellExec = (
  command: string,
  args: string[],
  options?: { cwd?: string; timeout?: number },
) => Promise<{ stdout: string; stderr: string; code: number }>;

/** Parent session identity — grouped fields that travel together from the tool boundary. */
export type ParentSessionInfo = Readonly<{
  /** Path to the parent session's JSONL file (for deriving the subagent session directory). */
  parentSessionFile?: string;
  /** Session ID of the parent agent (stored in the child session's parentSession header). */
  parentSessionId?: string;
  /** Tool call ID for background notification wiring. Exposed on the record via Subagent.toolCallId. */
  toolCallId?: string;
}>;

/** Compaction event info passed through lifecycle observers. */
export type CompactionInfo = {
  reason: "manual" | "threshold" | "overflow";
  tokensBefore: number;
};
