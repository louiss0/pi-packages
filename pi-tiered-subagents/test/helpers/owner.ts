import type { SessionOwner } from "#src/lifecycle/session-owner";

/**
 * The token a fixture's launches are stamped with.
 *
 * Tests drive the manager directly rather than through Pi's session events, so
 * without this every launch would be refused: the manager only accepts work
 * for the session that issued the current token, and a fixture that never
 * issued one has none. A test that is about ownership names its own token (or
 * calls `beginOwner`) instead of using this one.
 */
export const TEST_OWNER: SessionOwner = {
  generation: 1,
  sessionId: "session-1",
};
