/**
 * session-config.ts — Pure configuration assembler for agent sessions.
 *
 * `assembleSessionConfig()` is the pure assembly core called by
 * `createSubagentSession()`. It accepts resolved inputs (agent type, narrow
 * context, run options, env info) and returns everything the factory needs to
 * create the SDK session — without importing or constructing any Pi SDK types.
 *
 * The only async IO in the assembly phase (`detectEnv`) is handled by the caller
 * before invoking this function, keeping the assembler synchronous.
 */

import type { Model } from "@earendil-works/pi-ai";
import { defined } from "#src/optional";
import { resolveChildToolNames } from "#src/agents/definition";
import type { AgentDefinitionLookup } from "#src/agents/registry";
import type { EnvInfo } from "#src/session/env";
import type { ModelRegistry } from "#src/models/registry";
import type { ProjectContextLoader } from "#src/session/project-context";
import type { AgentPromptConfig, InheritedPrompt } from "#src/session/prompts";
import type {
  PromptInheritance,
  SubagentType,
  ThinkingLevel,
} from "#src/types";

// ── Public interfaces ────────────────────────────────────────────────────────

/**
 * IO collaborators injected into `assembleSessionConfig`.
 *
 * Bundling the IO-touching (or promptly testable) function into a single
 * interface keeps the assembler free of direct module imports and makes it
 * trivially testable without `vi.mock()` — callers inject real implementations
 * at the edge (`create-subagent-session.ts`) or stubs in tests.
 */
export interface AssemblerIO {
  buildAgentPrompt: (
    config: AgentPromptConfig,
    cwd: string,
    env: EnvInfo,
    inherited?: InheritedPrompt,
    loadProjectContext?: ProjectContextLoader,
  ) => string;
  /**
   * Resolves a directory's project instructions. Relayed to the prompt builder,
   * which decides whether this child needs its own — the assembler never calls
   * it, so a child that inherits an accurate block does no file IO.
   */
  loadProjectContext: ProjectContextLoader;
}

/**
 * Narrow context the assembler reads from the parent session.
 * Tests construct plain objects satisfying this interface — no SDK mocking needed.
 *
 * The assembler never inspects model internals, only passes them through; the
 * model was already resolved by the door.
 */
export interface AssemblerContext {
  /** Parent working directory (overridable via options.cwd). */
  cwd: string;
  /** Parent's effective system prompt (for append-mode agents). */
  parentSystemPrompt: string;
  /** Parent's operator-authored parts, for a child on a re-homing provider. */
  parentPortablePrompt?: string;
  /**
   * Which prompt-inheritance strategy the child's provider calls for.
   * Absent resolves every child to `"full"`.
   */
  resolvePromptInheritance?: (
    provider: string | undefined,
  ) => PromptInheritance;
  /** Parent's current model instance (fallback when agent config has no model). */
  parentModel?: Model<any>;
  /** Model registry for resolving config.model strings. */
  modelRegistry: ModelRegistry;
  /**
   * The parent's active tool names, captured when the request was made.
   *
   * A definition that inherits its tools takes these, so a child queued
   * behind another one runs with the tools the parent had when it was asked
   * for — not the ones it has now.
   */
  activeToolNames: readonly string[];
  /**
   * The tools the child was given, resolved when the request was made.
   *
   * The door resolves the effective selection once — the definition's
   * selection against the parent's captured tools — and passes the names
   * here, so the child runs with exactly the tools the runtime classified
   * it by. A definition edited while the child waited cannot hand it a
   * capability it was never cleared for.
   */
  toolNames?: readonly string[];
}

/**
 * Narrow slice of per-spawn execution fields consumed by the assembler.
 * All fields are optional — callers pass only what they have.
 */
export interface AssemblerOptions {
  /** Override working directory (e.g. for worktree isolation). */
  cwd?: string;
  /** Explicit model override — wins over agentConfig.model and parent model. */
  model?: Model<any>;
  /** Explicit thinking level — wins over agentConfig.thinking. */
  thinkingLevel?: ThinkingLevel;
}

/**
 * Assembled configuration returned to `createSubagentSession()`.
 * Contains everything needed to create the SDK session and filter tools —
 * with no SDK object references.
 */
export interface SessionConfig {
  /** Resolved working directory (`options.cwd ?? ctx.cwd`). */
  effectiveCwd: string;
  /** Fully-assembled system prompt string (ready for `systemPromptOverride`). */
  systemPrompt: string;
  /** Built-in tool name allowlist for this agent type. */
  toolNames: string[];
  /**
   * Resolved model instance (undefined → use parent model as passed to SDK).
   * The assembler passes it through without inspection.
   */
  model: Model<any> | undefined;
  /** Resolved thinking level (undefined → inherit from session). */
  thinkingLevel: ThinkingLevel | undefined;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

// ── Public function ──────────────────────────────────────────────────────────

/**
 * Assemble all configuration needed to create an agent session.
 *
 * Synchronous and side-effect-free — all IO is delegated through the `io`
 * parameter. The caller is responsible for resolving `EnvInfo` beforehand
 * via `detectEnv()`.
 *
 * @param type       The subagent type name (case-insensitive registry lookup).
 * @param ctx        Narrow context from the parent session.
 * @param options    Per-call overrides (cwd, model, thinkingLevel).
 * @param env        Pre-resolved environment info from `detectEnv()`.
 * @param registry   Agent config lookup — provides resolveAgentConfig and getToolNamesForType.
 * @param io         IO collaborators (skill loader, memory builder, prompt builder).
 */
export function assembleSessionConfig(
  type: SubagentType,
  ctx: AssemblerContext,
  options: AssemblerOptions,
  env: EnvInfo,
  registry: AgentDefinitionLookup,
  io: AssemblerIO,
): SessionConfig {
  const selection = registry.select(type);
  if (!selection.ok) {
    // The spawn door selected the agent already; reaching here means the
    // definition changed between the two, which is an error, not a fallback.
    throw new Error(selection.error);
  }
  const definition = selection.definition;

  const effectiveCwd = options.cwd ?? ctx.cwd;

  // The tools the child gets: the names the door resolved when the request
  // was made, or — when the door resolved none — the definition's selection
  // against the parent's captured tools.
  const toolNames =
    ctx.toolNames !== undefined
      ? [...ctx.toolNames]
      : resolveChildToolNames(definition.tools, ctx.activeToolNames);

  // Model resolution: explicit option > config model string > parent model.
  // Resolved before the prompt because the child's provider is what selects a
  // prompt-inheritance strategy; the two computations are otherwise
  // independent, so the order is free.
  // The model was already resolved by the door: the request's own choice, the
  // definition's, or the automatic step down the parent's ladder. The assembler
  // only passes it through, so the two doors cannot resolve differently.
  const model = options.model ?? ctx.parentModel;

  // Build system prompt from the resolved definition. The strategy is keyed
  // on the child's own provider, so a per-spawn model override moves the child
  // between transports and takes the right strategy with it.
  const systemPrompt = io.buildAgentPrompt(
    { name: definition.id, instructions: definition.instructions },
    effectiveCwd,
    env,
    {
      systemPrompt: ctx.parentSystemPrompt,
      cwd: ctx.cwd,
      strategy: ctx.resolvePromptInheritance?.(model?.provider) ?? "full",
      ...defined({ portablePrompt: ctx.parentPortablePrompt }),
    },
    io.loadProjectContext,
  );

  // Thinking level: explicit option > agent config > undefined (inherit)
  const thinkingLevel = options.thinkingLevel ?? definition.thinking;

  // The turn ceiling is not resolved here: the door decided it, once, from the
  // request, the definition, and the operator's captured default. The assembler
  // must not merge a second policy or read a default of its own.
  return {
    effectiveCwd,
    systemPrompt,
    toolNames,
    model,
    thinkingLevel,
  };
}
