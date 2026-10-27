/**
 * gate.ts — The exclusive slot a child that may change files holds.
 *
 * The slot is the runtime's answer to two children reaching for the same
 * files at once. It is a *slot*, not a lock on the files: the runtime cannot
 * know which files a child will touch, so it makes the conservative promise
 * that only one child that may change files runs at a time in a workspace.
 *
 * The gate hands the slot straight to the next waiter rather than freeing it
 * and re-granting it, so a moment never exists in which two children hold it.
 *
 * The gate says nothing about the parent's own edits, about another process
 * working in the same directory, or about what a reader sees while a writer
 * works. It is a scheduling rule between this runtime's children, not a
 * sandbox and not a snapshot.
 */

import { resolve } from "node:path";

/** A child waiting for the slot. */
type Waiter = Readonly<{
  /** The child waiting. */
  id: string;
  /** Whether the slot was granted (true) or the wait was cancelled (false). */
  resolve: (granted: boolean) => void;
  /** Detaches the cancellation listener, once the wait is over. */
  detach: () => void;
}>;

/**
 * The exclusive slot for one workspace.
 *
 * The gate is a small state machine: no holder, or one holder and a queue of
 * waiters. Every acquisition settles — granted or cancelled — so a caller
 * never waits for a slot that will not come.
 */
export class WorkspaceGate {
  private holder: string | undefined;
  private readonly waiting: Waiter[] = [];

  /** The child holding the slot, if any. */
  get holderId(): string | undefined {
    return this.holder;
  }

  /** How many children are waiting for the slot. */
  get waitingCount(): number {
    return this.waiting.length;
  }

  /**
   * Take the slot if it is free, without waiting.
   *
   * The caller that gets the slot starts its run in the same turn, so a run
   * that does not have to wait does not start later than it used to.
   */
  tryAcquire(id: string): boolean {
    if (this.holder !== undefined) return false;
    this.holder = id;
    return true;
  }

  /**
   * Take the slot, waiting for it when another child holds it.
   *
   * Resolves true when the slot was granted and false when the wait was
   * cancelled — the caller's signal fired while it waited — in which case the
   * slot was never taken and must not be released.
   */
  acquire(id: string, signal?: AbortSignal): Promise<boolean> {
    if (this.holder === undefined) {
      this.holder = id;
      return Promise.resolve(true);
    }
    // A signal that has already fired will never fire again, so the wait
    // would never end: it ends now instead.
    if (signal?.aborted) return Promise.resolve(false);
    return new Promise<boolean>((resolveWait) => {
      const waiter: Waiter = {
        id,
        resolve: resolveWait,
        detach: () => signal?.removeEventListener("abort", onAbort),
      };
      const onAbort = () => {
        const index = this.waiting.indexOf(waiter);
        if (index < 0) return;
        this.waiting.splice(index, 1);
        resolveWait(false);
      };
      this.waiting.push(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /**
   * Give the slot up, handing it straight to the next waiter.
   *
   * A release from a child that does not hold the slot is ignored: the slot
   * belongs to one child at a time, and a stale release must not free it.
   */
  release(id: string): void {
    if (this.holder !== id) return;
    const next = this.waiting.shift();
    if (!next) {
      this.holder = undefined;
      return;
    }
    this.holder = next.id;
    next.detach();
    next.resolve(true);
  }
}

/**
 * The gates of the workspaces a process has children in.
 *
 * One registry per runtime, handed to the managers it creates: the children
 * of two parents working in the same directory share one slot, because they
 * reach for the same files.
 */
export class WorkspaceGateRegistry {
  private readonly gates = new Map<string, WorkspaceGate>();

  /**
   * The gate for a workspace.
   *
   * Keyed by the resolved directory, so two parents working in the same
   * directory share one slot: the children of both compete for the same
   * files.
   *
   * The registry keeps one entry per directory it has been asked about. An
   * entry is never replaced — a gate that is handed out and given back stays
   * the gate that directory uses — so the number of entries is the number of
   * workspaces, which is small, and the promise holds for as long as the
   * runtime runs.
   */
  gateFor(cwd: string): WorkspaceGate {
    const key = resolve(cwd);
    let gate = this.gates.get(key);
    if (!gate) {
      gate = new WorkspaceGate();
      this.gates.set(key, gate);
    }
    return gate;
  }
}
