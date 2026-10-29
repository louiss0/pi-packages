/**
 * session-owner.ts — Which parent session a request belongs to.
 *
 * A request that names no session still belongs to one. Pi replaces the parent
 * session underneath a long-running child — `/new`, resuming a different
 * conversation, forking — and when it does, the child belongs to the session
 * that asked for it, not to whatever session happens to be current later.
 *
 * Without a name for that, nothing can tell the two apart: a launch prepared
 * under one session can be accepted under another, and a caller holding an id
 * from a previous session can resume its children. `SessionOwner` is the name.
 * The manager issues one per session (`beginOwner`), stamps it on every launch
 * it accepts, and checks it at the moment of acceptance.
 */

/**
 * The session a request was made under, and the only one allowed to accept it.
 *
 * `generation` is the identity that actually matters. `sessionId` is carried
 * because it is the sentence an operator needs when a launch is refused — "the
 * session that asked for this is gone" is a far better answer than "generation
 * 4 is stale" — and because comparing it is how a switch that was attempted and
 * then abandoned is told apart from one that took effect.
 *
 * A generation is never reused, so a token from a previous session can never
 * compare equal to a later one even when Pi hands the same id back.
 */
export type SessionOwner = Readonly<{
  generation: number;
  sessionId: string;
}>;

/** Why a launch was refused before any child existed. */
export type LaunchRejection =
  /** No session is active, so there is nothing to belong to. */
  | "no-active-session"
  /**
   * The session that asked for this has ended. Its children were cancelled
   * when it did; accepting more work for it would attach the result to a
   * session that is no longer there to receive it.
   */
  | "session-ended"
  /** The named agent type is not in the catalog. */
  | "unknown-agent"
  /** The named agent type is present but switched off. */
  | "disabled-agent";

/**
 * A launch's verdict.
 *
 * A refusal is an expected outcome, not a failure of the call: the caller asked
 * for something the current session cannot give it, and the answer says which.
 * Only a genuine defect throws.
 */
export type LaunchOutcome<T> =
  | { kind: "accepted"; value: T }
  | { kind: "rejected"; reason: LaunchRejection };

/** Whether `owner` may still accept work: it must be the live, ending-free owner. */
export function ownerCanAccept(
  owner: SessionOwner | undefined,
  live: SessionOwner | undefined,
): owner is SessionOwner {
  return (
    owner !== undefined &&
    live !== undefined &&
    owner.generation === live.generation
  );
}
