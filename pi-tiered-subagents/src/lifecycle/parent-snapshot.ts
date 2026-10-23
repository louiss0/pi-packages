/**
 * parent-snapshot.ts — Capture parent session state as a plain data snapshot.
 */

import { buildParentContext } from "#src/session/context";
import type { ExactModelIdentity } from "#src/models/identity";
import { defined } from "#src/optional";
import type { SessionContext } from "#src/types";

/**
 * The parent session's operator-authored prompt parts, as Pi reports them on
 * `before_agent_start`.
 *
 * A narrow structural slice of Pi's `BuildSystemPromptOptions` holding the
 * layers an operator wrote that describe no single session. `skills` is
 * excluded for the reason ADR 0006 cuts the catalogue: the child loads its
 * own. `contextFiles` is excluded for the same reason — the block names each
 * file by absolute path, so the child resolves it against its own directory
 * (#918). `promptGuidelines` is excluded because Pi derives it per session from
 * the tools actually in the registry, so inheriting the parent's would assert
 * guidance for tools the child may not hold — the defect ADR 0008 removed with
 * the `<sub_agent_context>` block. `selectedTools` and `toolSnippets` are
 * excluded because the tool surface is node-local prose.
 */
export interface ParentPromptOptions {
  /** Custom system prompt (`--system-prompt`), when the parent runs one. */
  customPrompt?: string;
  /** Appended system prompt text (`--append-system-prompt`). */
  appendSystemPrompt?: string;
}

/**
 * Plain data snapshot of the parent session state captured at spawn time.
 * Replaces live `ExtensionContext` references so queued agents don't read stale state.
 *
 * Every field is an owned value: text, names, and identities. Live SDK
 * collaborators stay at the child-session creation boundary rather than
 * travelling with accepted or queued work.
 */
export interface ParentSnapshot {
  /** Parent working directory. */
  cwd: string;
  /** Parent's effective system prompt (for append-mode agents). */
  systemPrompt: string;
  /**
   * The parent's model as an owned identity, captured with the request
   * (ARCHITECTURE-SPEC stories 15 and 40).
   *
   * Absent, rather than present-and-undefined, when the parent has no model
   * or none with a provider: a snapshot is read long after the capture, and
   * the identity — not the live SDK object — is the durable fact. Execution
   * materializes it through the model bridge; a model the session no longer
   * reports is an explicit failure, never a silent substitution (story 42).
   */
  parentModelIdentity?: ExactModelIdentity;
  /**
   * The tools the parent session had active when the request was made.
   *
   * A definition that inherits its tools takes these, so a child that waits
   * for a concurrency slot runs with the parent's selection as it was when
   * the child was asked for — not as it is when the slot opens.
   */
  activeToolNames: readonly string[];
  /**
   * Every tool name registered in the parent when the request was made.
   * MCP wildcard declarations expand against this copy before acceptance, so
   * a server connecting later cannot widen queued work.
   */
  registeredToolNames: readonly string[];
  /** Pre-built parent conversation text (when inheritContext was requested). */
  parentContext?: string;
  /**
   * The parent's operator-authored parts, rendered as an identity a child on a
   * re-homing provider may adopt in place of the assembled prompt (ADR 0009):
   * the custom prompt, then the appended prompt wrapped as an `<addendum>`
   * section.
   * Undefined when Pi has assembled no prompt yet, or when the parent has no
   * such parts.
   */
  portablePrompt?: string;
}

/**
 * Build an immutable snapshot of the parent session state.
 *
 * Called once at spawn time so queued agents capture state as it existed
 * when the user requested the agent, not when a queue slot opens.
 */
export function buildParentSnapshot(
  ctx: SessionContext,
  inheritContext?: boolean,
  promptOptions?: ParentPromptOptions,
  activeToolNames: readonly string[] = [],
  registeredToolNames: readonly string[] = [],
): ParentSnapshot {
  const parentContext = inheritContext ? buildParentContext(ctx) : undefined;
  return {
    cwd: ctx.cwd,
    systemPrompt: ctx.getSystemPrompt(),
    // Copied, so a parent that changes its active tools later cannot widen a
    // queued child's capabilities.
    activeToolNames: [...activeToolNames],
    registeredToolNames: [...registeredToolNames],
    ...defined({
      parentModelIdentity: parentModelIdentity(ctx.model),
      parentContext: parentContext || undefined,
      portablePrompt: buildPortablePrompt(promptOptions),
    }),
  };
}

/**
 * The parent's model as an owned identity, when the parent runs one with a
 * provider. The identity is the durable fact; the live SDK object stays in
 * the session and is materialized from it at execution.
 */
function parentModelIdentity(
  model: { provider?: string; id: string } | undefined,
): ExactModelIdentity | undefined {
  if (!model?.provider) return undefined;
  return { provider: model.provider, id: model.id };
}

/**
 * Compose the parent's operator-authored parts into an identity a child may
 * adopt, in the order and shape Pi's own `buildSystemPrompt` composes them
 * from 0.86: the custom prompt, then the appended prompt as an `<addendum>`
 * section. Pi through 0.85 wrote the appended prompt bare; one shape is
 * composed for every host.
 *
 * The result is what Pi would assemble for a session with a custom prompt and
 * no tools, skills, or context files, so a host that re-homes it sees text
 * shaped the way its own harness produces — not Pi's base preamble. The child
 * appends its own directory's project context after it.
 *
 * Returns undefined when no part survives, which routes the caller to the
 * generic base rather than back to the full prompt.
 */
function buildPortablePrompt(
  options?: ParentPromptOptions,
): string | undefined {
  if (!options) return undefined;
  const sections: string[] = [];
  const custom = options.customPrompt?.trim();
  if (custom) sections.push(custom);
  const appended = options.appendSystemPrompt?.trim();
  if (appended) sections.push(`<addendum>\n${appended}\n</addendum>`);
  return sections.length > 0 ? sections.join("\n\n") : undefined;
}
