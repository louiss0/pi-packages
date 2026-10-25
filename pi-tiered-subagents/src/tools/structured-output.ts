/**
 * structured-output.ts — Typed output contracts for the subagent tools.
 *
 * The SDK lets a tool declare `outputSchema`: the JSON Schema of the
 * `structuredContent` its results carry for programmatic callers (codemode
 * scripts receive it instead of the text content). The model-facing text is
 * unchanged — structured output replaces parsing display text, it does not
 * replace the human-readable details, and it is not terminal rendering (the
 * renderers keep reading `details`).
 *
 * Each payload type is derived from its schema with `Static`, so the type a
 * builder is checked against and the schema a consumer validates with cannot
 * drift. Expected rejections (an unknown agent, a refused resume, a steer to
 * a finished agent) are ordinary payload values; defects surface as errors.
 */

import type { JsonValue } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";

// ---- subagent ----

/**
 * What a `subagent` call ended with.
 *
 * - `accepted`: a child exists — a background launch or resume returned at
 *   once; `agentId` names it and `queued` says whether it awaits a slot.
 * - `completed`: a foreground run or resume settled before the call returned;
 *   `status` says how, and `result`/`error` carry what it ended with. A child
 *   whose execution failed is an accepted child with an execution failure, so
 *   it lands here with `status: "error"`, not in `failed`.
 * - `rejected`: no child ran — `reason` names the structured refusal (a
 *   preparation, acceptance, or resume refusal).
 * - `failed`: the extension's own machinery threw; the result is also flagged
 *   `isError`, so a consumer does not mistake a defect for an answer.
 */
export const subagentOutputSchema = Type.Object({
  outcome: Type.Union([
    Type.Literal("accepted"),
    Type.Literal("completed"),
    Type.Literal("rejected"),
    Type.Literal("failed"),
  ]),
  agentId: Type.Optional(Type.String()),
  /** The normalized agent type identifier the call resolved to. */
  agentType: Type.Optional(Type.String()),
  background: Type.Optional(Type.Boolean()),
  resumed: Type.Optional(Type.Boolean()),
  /** A background launch waiting for a concurrency slot. */
  queued: Type.Optional(Type.Boolean()),
  /** The settled run's status, for `completed`. */
  status: Type.Optional(Type.String()),
  result: Type.Optional(Type.String()),
  error: Type.Optional(Type.String()),
  /** The structured refusal or failure reason, for `rejected`/`failed`. */
  reason: Type.Optional(Type.String()),
  outputFile: Type.Optional(Type.String()),
  toolUses: Type.Optional(Type.Number()),
  durationMs: Type.Optional(Type.Number()),
});
export type SubagentToolOutput = Static<typeof subagentOutputSchema>;

// ---- get_subagent_result ----

/**
 * The machine-readable twin of the get_subagent_result report: the same
 * facts, as values a caller reads instead of parsing the report's lines.
 * `found: false` is the expected unknown-agent rejection; every other field
 * rides with `found: true`.
 */
export const getResultOutputSchema = Type.Object({
  found: Type.Boolean(),
  agentId: Type.String(),
  status: Type.Optional(Type.String()),
  displayName: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  /** The model's `provider/id`; absent while an inherited model is unknown. */
  model: Type.Optional(Type.String()),
  result: Type.Optional(Type.String()),
  error: Type.Optional(Type.String()),
  toolUses: Type.Optional(Type.Number()),
  contextPercent: Type.Optional(Type.Number()),
  compactionCount: Type.Optional(Type.Number()),
  durationMs: Type.Optional(Type.Number()),
  /** False exactly when `resumeRefusal` names why a resume would be refused. */
  resumable: Type.Optional(Type.Boolean()),
  resumeRefusal: Type.Optional(Type.String()),
  pendingQuestion: Type.Optional(Type.String()),
  stoppedWhileQueued: Type.Optional(Type.Boolean()),
  /** The waited run was replaced by a resume before the wait returned. */
  resumedWhileWaiting: Type.Optional(Type.Boolean()),
  /** The bound, in seconds, of a wait that ended at it still running. */
  waitExpiredAfter: Type.Optional(Type.Number()),
  transcriptPath: Type.Optional(Type.String()),
  /** The full conversation, present only when verbose was requested. */
  conversation: Type.Optional(Type.String()),
});
export type GetResultToolOutput = Static<typeof getResultOutputSchema>;

// ---- steer_subagent ----

/**
 * What a `steer_subagent` call did with the message. `rejected` (not running)
 * and `not-found` are expected rejections reported as values; `failed` is a
 * defect, also flagged `isError` on the result.
 */
export const steerOutputSchema = Type.Object({
  agentId: Type.String(),
  outcome: Type.Union([
    Type.Literal("delivered"),
    Type.Literal("queued"),
    Type.Literal("rejected"),
    Type.Literal("not-found"),
    Type.Literal("failed"),
  ]),
  /** The agent's status when a steer was rejected for not running. */
  status: Type.Optional(Type.String()),
});
export type SteerToolOutput = Static<typeof steerOutputSchema>;

// ---- Attachment ----

/** The structured payloads the subagent tools attach to their results. */
export type StructuredToolOutput =
  | SubagentToolOutput
  | GetResultToolOutput
  | SteerToolOutput;

/**
 * Attach a schema-matching payload to a text tool result, leaving the
 * model-facing content and the renderer's details untouched.
 */
export function withStructured<R extends { content: unknown }>(
  result: R,
  output: StructuredToolOutput,
): R & { structuredContent: JsonValue } {
  // The payload is built only from schema-typed fields; widening it once here
  // to the SDK's `JsonValue` wire type keeps that cast out of every door.
  return { ...result, structuredContent: output as JsonValue };
}
