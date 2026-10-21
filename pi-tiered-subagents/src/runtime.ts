/**
 * runtime.ts — SubagentRuntime: composition root for all mutable extension state.
 *
 * Eliminates module-scope state in agent-runner.ts and closure-scoped state
 * in index.ts by consolidating them into a single, testable object.
 * Follows the same pattern as pi-permission-system's ExtensionRuntime.
 */

import {
  buildParentSnapshot,
  type ParentPromptOptions,
  type ParentSnapshot,
} from "#src/lifecycle/parent-snapshot";
import { routingContext, type RoutingLadders } from "#src/models/router";
import type { ModelInfo } from "#src/tools/spawn-config";
import type { SessionContext } from "#src/types";

/**
 * Narrow config subset read by Agent when driving the turn loop (defaultMaxTurns, wrapUpTurns).
 * Kept separate so callers can satisfy it without depending on the full runtime.
 */
export interface RunConfig {
  readonly defaultMaxTurns: number | undefined;
  readonly wrapUpTurns: number;
  /** Whether a background child gets the `notify_parent` channel. */
  readonly midRunUpdates: boolean;
}

/**
 * All mutable state owned by the pi-subagents extension.
 *
 * Created once inside `piSubagentsExtension()` via `createSubagentRuntime()`.
 * Tests construct a fresh runtime per test for full isolation.
 */
export class SubagentRuntime {
  // ── Session state (was closure-scoped in index.ts) ───────────────────────
  /** Active Pi session context — set on session_start, cleared on session_shutdown. */
  currentCtx: SessionContext | undefined = undefined;

  /**
   * The names of the tools the parent session has active.
   *
   * Read from Pi's extension API when the request is made, so a definition
   * that inherits its tools takes the parent's current selection rather than
   * a configured list.
   */
  private listActiveTools: () => string[];

  /**
   * The routing ladders the automatic model selection walks.
   */
  private readonly ladders: RoutingLadders;

  /**
   * Prompt options Pi assembled for the parent's latest turn, captured from
   * `before_agent_start`. Undefined until the parent has run one.
   */
  private lastPromptOptions: ParentPromptOptions | undefined = undefined;

  constructor(
    listActiveTools: () => string[] = () => [],
    ladders: RoutingLadders = { profiles: new Map(), strategies: new Map() },
  ) {
    this.listActiveTools = listActiveTools;
    this.ladders = ladders;
  }

  // ── Session-context methods ──────────────────────────────────────────────

  /** Store the active Pi session context (called from session_start). */
  setSessionContext(ctx: SessionContext): void {
    this.currentCtx = ctx;
  }

  /** Clear the session context (called from session_shutdown). */
  clearSessionContext(): void {
    this.currentCtx = undefined;
  }

  /**
   * Record the prompt options Pi assembled for the parent's latest turn.
   *
   * Captured from `before_agent_start`, which is the only event carrying them:
   * `getSystemPromptOptions()` is attached to a command context, not to the
   * session context this runtime holds.
   */
  setSystemPromptOptions(options: ParentPromptOptions): void {
    this.lastPromptOptions = options;
  }

  /**
   * Build a parent snapshot from the current session context.
   * Only valid during an active session (currentCtx is defined).
   */
  buildSnapshot(inheritContext: boolean): ParentSnapshot {
    return buildParentSnapshot(
      this.currentCtx!,
      inheritContext,
      this.lastPromptOptions,
      this.listActiveTools(),
    );
  }

  /** Extract model info from the current session context. */
  getModelInfo(): ModelInfo {
    const registry = this.currentCtx?.modelRegistry;
    return {
      parentModel: this.currentCtx?.model,
      modelRegistry: registry,
      // The models the session can run are a session fact, so the routing
      // context is built here, per request.
      routing: routingContext(
        this.ladders,
        registry?.getAvailable?.() ?? registry?.getAll() ?? [],
      ),
    };
  }

  /** Extract session identity from the current session context. */
  getSessionInfo(): { parentSessionFile: string; parentSessionId: string } {
    return {
      parentSessionFile: this.currentCtx?.sessionManager.getSessionFile() ?? "",
      parentSessionId: this.currentCtx?.sessionManager.getSessionId() ?? "",
    };
  }
}

/**
 * Create a fully-initialized SubagentRuntime with default values.
 *
 * Call once at extension startup; pass the result to factories and handlers.
 */
export function createSubagentRuntime(
  listActiveTools: () => string[] = () => [],
  ladders: RoutingLadders = { profiles: new Map(), strategies: new Map() },
): SubagentRuntime {
  return new SubagentRuntime(listActiveTools, ladders);
}
