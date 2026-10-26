import type { SessionContext } from "#src/types";

/**
 * Session lifecycle event handlers: session_start, session_before_switch, session_shutdown.
 *
 * Extracted from index.ts so each handler can be tested in isolation
 * with mocked narrow interfaces.
 */

/** Narrow manager interface — only the methods lifecycle handlers call. */
export interface LifecycleManager {
  clearCompleted(): Promise<void>;
  abortAll(): void;
  dispose(): Promise<void>;
  /** Take ownership for a session, ending whatever session held it before. */
  beginOwner(sessionId: string): void | Promise<void>;
  /** Note that the session may be replaced, without cancelling anything yet. */
  beginOwnerEnd(): void;
  /** End the session for good; no later session will restore it. */
  endOwner(): void | Promise<void>;
}

/** Narrow runtime interface — only the methods lifecycle handlers call. */
export interface LifecycleRuntime {
  setSessionContext(ctx: SessionContext): void;
  clearSessionContext(): void;
}

/**
 * Handles session lifecycle events.
 *
 * Constructor deps:
 * - `runtime` — owns session context state
 * - `manager` — manages agent lifecycle (clear, abort, dispose)
 * - `disposeNotifications` — tears down the notification system on shutdown
 * - `unpublishService` — unpublishes the SubagentsService symbol on shutdown
 */
export class SessionLifecycleHandler {
  /** Shared by repeated lifecycle delivery so cleanup is one awaited operation. */
  private shutdownPromise: Promise<void> | undefined;

  constructor(
    private readonly runtime: LifecycleRuntime,
    private readonly manager: LifecycleManager,
    private readonly disposeNotifications: () => void,
    private readonly unpublishService: () => void,
    /**
     * The current session's identity, for handing the manager ownership of it.
     *
     * Read from the session context rather than taken from the event: the
     * context is the thing whose replacement cancels children's work, so the
     * ownership token must name the session that actually exists.
     */
    private readonly sessionIdOf: (ctx: unknown) => string,
  ) {}

  /**
   * A session began, so this one owns the work accepted from now on.
   *
   * `beginOwner` is what confirms a switch: reaching here after a
   * `session_before_switch` means the replacement took effect, and the previous
   * session's children are cancelled. A same-id owner transition can preserve
   * children when a host reports an abandoned attempt; Pi 1.3.0's actual veto
   * path emits no `session_start`, so the before-switch hook remains a no-op.
   */
  async handleSessionStart(_event: unknown, ctx: unknown): Promise<void> {
    const context = ctx as SessionContext;
    this.runtime.setSessionContext(context);
    // A confirmed replacement does not expose its new owner until the old
    // owner's children have completed their bounded shutdown and SDK disposal.
    await this.manager.beginOwner(this.sessionIdOf(context));
    await this.manager.clearCompleted();
  }

  /**
   * A replacement may be about to happen.
   *
   * Pi 1.3.0 returns immediately when any `session_before_switch` handler
   * vetoes and emits neither `session_shutdown` nor `session_start`. There is
   * no post-veto callback in the SDK with which to restore ownership, so this
   * hook must not mutate the owner or remove retained results. A confirmed
   * replacement runs `session_shutdown`, while the following `session_start`
   * performs the normal new-owner cleanup.
   */
  handleSessionBeforeSwitch(): Promise<void> {
    return Promise.resolve();
  }

  // Cleanup order matters:
  // 1. Unpublish service — prevent new cross-extension calls
  // 2. Clear session context — no more session state
  // 3. End session ownership — the session's children are cancelled, and a
  //    later session gets a fresh generation rather than inheriting this one's
  // 4. Dispose notifications — silence nudges *before* the aborts that would
  //    raise them: no parent run is active at shutdown, so a terminal
  //    transition delivers its nudge synchronously and Pi cannot recall it
  // 5. Abort all agents — stop running and queued work
  // 6. Dispose manager — final cleanup, awaited so each child's extensions get
  //    their `session_shutdown` before Pi tears the parent down (#709)
  handleSessionShutdown(): Promise<void> {
    if (!this.shutdownPromise) this.shutdownPromise = this.shutdownOnce();
    return this.shutdownPromise;
  }

  private async shutdownOnce(): Promise<void> {
    this.unpublishService();
    this.runtime.clearSessionContext();
    // Starting the owner end closes acceptance and cancellation synchronously.
    // Do not await it yet: notification delivery must be suppressed before the
    // terminal transitions caused by cancellation can publish a nudge.
    const ownerEnd = this.manager.endOwner();
    this.disposeNotifications();
    this.manager.abortAll();
    await ownerEnd;
    await this.manager.dispose();
  }
}
