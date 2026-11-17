/**
 * subagent-session.ts — The born-complete child-session value object (issue #265).
 *
 * A SubagentSession wraps one SDK AgentSession plus its turn-driving and teardown.
 * It is born complete: `createSubagentSession()` returns a fully usable instance
 * (session created, extensions bound, recursion guard applied), so the only thing
 * left for `Subagent` to do is coordinate — drive the turn loop, steer, dispose.
 *
 * Turn driving lives here, on the object that owns the AgentSession, rather than
 * reaching through `subagentSession.session` from `Subagent` (Law of Demeter).
 */

import type { Model } from "@earendil-works/pi-ai";
import {
  type AgentSession,
  type AgentSessionEvent,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { ChildLifecyclePublisher } from "#src/lifecycle/child-lifecycle";
import { emitChildSessionShutdown } from "#src/lifecycle/child-shutdown";
import {
  getSessionContextPercent,
  type SessionStatsLike,
} from "#src/lifecycle/usage";
import { extractText } from "#src/session/context";
import { getAgentConversation } from "#src/session/conversation";
import type { SessionMessage, ThinkingLevel } from "#src/types";

/** Outcome of one turn loop. */
export type TurnLoopResult = {
  responseText: string;
};

/** Per-call options for one run's turn loop. */
export type TurnLoopOptions = {
  signal?: AbortSignal;
};

/** Session-level facts known at creation, supplied by the factory. */
export type SubagentSessionMeta = {
  /** Path to the persisted session JSONL file, absent for a headless session. */
  outputFile?: string;
  /** Child session id — the registry key carried on session-created/disposed events. */
  sessionId: string;
  /** Child session directory — carried on the completed event as transcript location. */
  sessionDir: string;
  agentName: string;
  lifecycle: ChildLifecyclePublisher;
};

/**
 * One child AgentSession plus its turn-driving and teardown — born complete.
 */
export class SubagentSession {
  /**
   * The single teardown operation for this child. Retaining the promise (rather
   * than only a boolean) means a concurrent caller waits for the first caller's
   * shutdown handlers and SDK disposal instead of reporting completion early.
   */
  private disposePromise: Promise<void> | undefined;

  /**
   * Set as the session's first run starts, settled or not: only that run
   * announces the child's completion.
   */
  private hasRun = false;

  /**
   * The last inherited parent message present when this session was built.
   * The child's own turns are the messages after it. Identity, not a numeric
   * offset, survives compaction: when Pi rewrites the history the inherited
   * message is gone, and everything left belongs to the child.
   */
  private readonly inheritedLastMessage: SessionMessage | undefined;

  /**
   * How the session's last assistant turn ended, tracked for the session's
   * whole life rather than per call.
   *
   * Per call is not enough: a `prompt()` can resolve without running a turn at
   * all, and the failure a *previous* call observed may never have reached
   * `session.messages` for a later one to re-derive — Pi's overflow recovery
   * strips it and restores nothing when its compaction fails (#898).
   */
  private readonly turnFailure: ReturnType<typeof collectTurnFailure>;

  constructor(
    private readonly _session: AgentSession,
    private readonly meta: SubagentSessionMeta,
  ) {
    this.inheritedLastMessage = _session.messages.at(-1);
    this.turnFailure = collectTurnFailure(_session, () => this.ownMessages());
  }

  /**
   * Wrapped session — for lifecycle-internal use only.
   * @internal consumers outside lifecycle/ use the delegate methods below.
   */
  get session(): AgentSession {
    return this._session;
  }

  get outputFile(): string | undefined {
    return this.meta.outputFile;
  }

  /** The model the child is running now — a failover or `/model` switch shows here. */
  get model(): Model<any> | undefined {
    return this._session.model;
  }

  /** The child's current thinking level. */
  get thinkingLevel(): ThinkingLevel {
    return this._session.thinkingLevel;
  }

  /**
   * Drive one run's turn loop: the initial run, or a resume.
   *
   * The session's first run emits `completed` once its prompt resolves; a later
   * run does not.
   */
  async runTurnLoop(
    prompt: string,
    opts: TurnLoopOptions,
  ): Promise<TurnLoopResult> {
    const firstRun = !this.hasRun;
    this.hasRun = true;
    const responseText = await this.promptForAnswer(prompt, opts);
    if (firstRun) {
      this.meta.lifecycle.completed({
        sessionDir: this.meta.sessionDir,
        agentName: this.meta.agentName,
      });
    }
    return { responseText };
  }

  /**
   * Prompt the session for one run's answer.
   *
   * A signal that already fired takes no turn and has no answer. Forwarding it
   * would not stop the prompt: Pi's `abort()` is a no-op while no run is active,
   * so it cannot cancel a prompt started after it. Nor does the history answer
   * for it — on a resume, the last assistant text is the previous run's.
   */
  private async promptForAnswer(
    prompt: string,
    opts: TurnLoopOptions,
  ): Promise<string> {
    if (opts.signal?.aborted) return "";
    const session = this._session;
    const collector = collectResponseText(session);
    using _text = asDisposable(collector.unsubscribe);
    using _abort = asDisposable(forwardAbortSignal(session, opts.signal));

    await session.prompt(prompt);
    failIfProviderErrored(this.turnFailure.getFailure());

    return (
      collector.getText().trim() || getLastAssistantText(this.ownMessages())
    );
  }

  /** Deliver a steer to the live session. */
  async steer(message: string): Promise<void> {
    await this._session.steer(message);
  }

  /** Return the child's own conversation messages as formatted text. */
  getConversation(): string {
    return getAgentConversation({ messages: this.agentMessages });
  }

  /** Return the session context window utilization (0-100), or null when unavailable. */
  getContextPercent(): number | null {
    return getSessionContextPercent(this._session);
  }

  /** Subscribe to session events. Satisfies `SubscribableSession`. */
  subscribe(fn: (event: AgentSessionEvent) => void): () => void {
    return this._session.subscribe(fn);
  }

  /** Return session token statistics. Satisfies `SessionLike`. */
  getSessionStats(): SessionStatsLike {
    return this._session.getSessionStats();
  }

  /**
   * The child's own messages, excluding inherited parent history. A compacted
   * history no longer holds the fork's last inherited message; everything it
   * holds then belongs to the child's own run.
   */
  private ownMessages(): ReadonlyArray<SessionMessage> {
    const messages = this._session.messages;
    const last = this.inheritedLastMessage;
    if (last === undefined) return messages;
    const at = messages.indexOf(last);
    return at === -1 ? messages : messages.slice(at + 1);
  }

  /** The child session's own message history (excluding inherited parent messages). */
  get messages(): ReadonlyArray<unknown> {
    return this.ownMessages();
  }

  /** The child session's own message history, typed for Pi's session-rendering machinery. */
  get agentMessages(): ReadonlyArray<SessionMessage> {
    return this.ownMessages();
  }

  /** Resolve a registered tool definition by name, for Pi's tool-execution components. */
  getToolDefinition(name: string): ToolDefinition | undefined {
    return this._session.getToolDefinition(name);
  }

  /**
   * Tear down: child `session_shutdown` + session.dispose() + emit `disposed`
   * (registry unregister).
   */
  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposePromise = this.disposeOnce();
    return this.disposePromise;
  }

  private async disposeOnce(): Promise<void> {
    this.turnFailure.unsubscribe();
    await emitChildSessionShutdown(this._session);

    try {
      this._session.dispose?.();
    } finally {
      this.meta.lifecycle.disposed({ sessionId: this.meta.sessionId });
    }
  }
}

// ── Private turn-loop helpers ───────────────────────────────────────────────────

const PROVIDER_ERROR_WITHOUT_MESSAGE =
  "provider reported an error with no message";

function failIfProviderErrored(failure: string | undefined): void {
  if (failure) throw new Error(failure);
}

function collectTurnFailure(
  session: AgentSession,
  ownMessages: () => ReadonlyArray<SessionMessage>,
) {
  let failure = readLastTurnFailure(ownMessages());
  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (event.type !== "message_end" || event.message.role !== "assistant")
      return;
    failure =
      event.message.stopReason === "error"
        ? event.message.errorMessage || PROVIDER_ERROR_WITHOUT_MESSAGE
        : undefined;
  });
  return { getFailure: () => failure, unsubscribe };
}

function readLastTurnFailure(
  messages: ReadonlyArray<SessionMessage>,
): string | undefined {
  const last = messages.findLast((msg) => msg.role === "assistant");
  if (!last || last.stopReason !== "error") return undefined;
  return last.errorMessage || PROVIDER_ERROR_WITHOUT_MESSAGE;
}

function collectResponseText(session: AgentSession) {
  let text = "";
  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (event.type === "message_start") {
      text = "";
    }
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      text += event.assistantMessageEvent.delta;
    }
  });
  return { getText: () => text, unsubscribe };
}

function getLastAssistantText(messages: ReadonlyArray<SessionMessage>): string {
  const texts = messages
    .filter((msg) => msg.role === "assistant")
    .map((msg) => extractText(msg.content).trim())
    .filter((text) => text !== "");
  return texts.at(-1) ?? "";
}

function asDisposable(unsubscribe: () => void): Disposable {
  return { [Symbol.dispose]: unsubscribe };
}

function forwardAbortSignal(
  session: AgentSession,
  signal?: AbortSignal,
): () => void {
  if (!signal) return () => {};
  const onAbort = (): void => {
    void session.abort();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}
