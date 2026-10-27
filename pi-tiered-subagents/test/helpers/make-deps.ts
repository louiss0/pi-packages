import { vi } from "vitest";
import { defined, type Patch } from "#src/optional";
import { AgentRegistry } from "#src/agents/registry";
import { LaunchPreparer } from "#src/agents/launch-preparer";
import type { ModelInfo } from "#src/agents/resolver";
import {
  Subagents,
  type SubagentsManager,
  type SubagentsRuntime,
} from "#src/service/subagents";
import { SHIPPED_STRATEGIES, strategiesByFamily } from "#src/models/strategy";
import { DEFAULT_WRAP_UP_TURNS } from "#src/lifecycle/turn-limits";
import type { Subagent } from "#src/lifecycle/subagent";
import type { ResumeRefusalReason } from "#src/lifecycle/subagent-manager";
import type {
  AgentToolManager,
  AgentToolSettings,
} from "../../extensions/index";
import { makeModel } from "./make-model";
import { createTestSubagent, type TestSubagentOptions } from "./make-subagent";
import { STUB_SNAPSHOT } from "./stub-ctx";
import { TEST_OWNER } from "./owner";

/** Minimal registry with the shipped specialists and no files. */
const defaultRegistry = new AgentRegistry(() => ({
  global: { definitions: [], errors: [] },
  project: { definitions: [], errors: [] },
}));

/**
 * Fixture shape returned by `createToolDeps`.
 * Contains the Agent tool factory's collaborators as separate fields so tests
 * can build the tool directly or use individual pieces for spawner/runner tests.
 */
export type AgentToolFixture = {
  manager: AgentToolManager & SubagentsManager;
  /** Mock runtime supplying parent captures and model facts. */
  runtime: SubagentsRuntime & { getModelInfo(): ModelInfo };
  subagents: Subagents;
  settings: AgentToolSettings;
  registry: AgentRegistry;
  preparer: LaunchPreparer;
  agentDir: string;
};

/**
 * Shared test fixture: builds a full `AgentToolFixture` with mock stubs and sensible defaults.
 *
 * Pass `overrides` to replace top-level fields.
 * To override a single nested method, spread the default nested object:
 * ```typescript
 * createToolDeps({ manager: { ...createToolDeps().manager, spawn: vi.fn().mockReturnValue("x") } })
 * ```
 */
export function createToolDeps(
  overrides: Patch<AgentToolFixture> = {},
): AgentToolFixture {
  const runtime: SubagentsRuntime & { getModelInfo(): ModelInfo } = {
    currentCtx: {},
    captureLaunchInputs: vi.fn(() => ({
      snapshot: STUB_SNAPSHOT,
      parentContext: "parent conversation",
      parentSession: {
        parentSessionFile: "/sessions/parent.jsonl",
        parentSessionId: "session-1",
      },
    })),
    getModelInfo: vi.fn(() => ({
      parentModel: makeModel({ id: "claude-sonnet", name: "Claude Sonnet" }),
      modelRegistry: {
        find: () => undefined,
        getAll: () => [],
        getAvailable: () => [],
      },
      ladders: {
        profiles: new Map(),
        strategies: strategiesByFamily(SHIPPED_STRATEGIES),
      },
    })),
  };

  const defaults = {
    manager: {
      spawn: vi.fn().mockReturnValue({ kind: "accepted", value: "agent-1" }),
      spawnAndWait: vi
        .fn()
        .mockResolvedValue({ kind: "accepted", value: createTestSubagent() }),
      startResume: vi
        .fn()
        .mockReturnValue({ kind: "started", record: createTestSubagent() }),
      getRecord: vi.fn().mockReturnValue(createTestSubagent()),
      currentOwner: vi.fn().mockReturnValue(TEST_OWNER),
    },
    runtime,
    settings: {
      defaultMaxTurns: undefined as number | undefined,
      wrapUpTurns: DEFAULT_WRAP_UP_TURNS,
      maxConcurrent: 4,
    },
    registry: defaultRegistry,
    agentDir: "/home/user/.pi",
  };
  const fixture = { ...defaults, ...defined(overrides) };
  const preparer = new LaunchPreparer({
    // The fixture re-reads through the registry's loader so a definition edit
    // between two executes is visible to the second request, matching the
    // production loader's fresh read per preparation.
    loadScopes: async () => {
      fixture.registry.reload();
      return fixture.registry.currentScopes();
    },
    modelInfo: () => fixture.runtime.getModelInfo(),
    turnSettings: () => fixture.settings,
    childShaping: () => ({
      midRunUpdates: true,
      excludedExtensionPackages: [],
      promptInheritance: {},
    }),
  });
  return {
    ...fixture,
    preparer,
    subagents: new Subagents(fixture.manager, fixture.runtime, preparer),
  };
}

/**
 * Point the fixture's `manager.startResume` at a record built from `overrides`,
 * and return that record so the test can assert on it.
 *
 * Owns the mock's result shape in one place: a test says which record comes
 * back, not how the manager reports it. Both resume doors start through
 * `startResume`, so one helper serves either.
 */
export function mockResumeStart(
  deps: AgentToolFixture,
  overrides: TestSubagentOptions = {},
): Subagent {
  const record = createTestSubagent(overrides);
  deps.manager.startResume = vi
    .fn()
    .mockReturnValue({ kind: "started", record });
  return record;
}

/**
 * Point the fixture's `manager.startResume` at a refusal, so a door test states
 * the reason it is wording rather than assembling a record that produces it.
 */
export function mockResumeRefusal(
  deps: AgentToolFixture,
  reason: ResumeRefusalReason,
): void {
  deps.manager.startResume = vi
    .fn()
    .mockReturnValue({ kind: "refused", reason });
}

/**
 * Build a tool fixture whose named specialists are disabled.
 *
 * A definition file that disables an agent refines the shipped one, so the
 * registry keeps the identifier and drops it from the enabled surface.
 */
export function createToolDepsWithDisabledBuiltInAgents(
  ...names: string[]
): AgentToolFixture {
  const registry = new AgentRegistry(() => ({
    global: {
      definitions: names.map((name) => ({
        id: name,
        patch: { enabled: false },
        path: `${name}.md`,
      })),
      errors: [],
    },
    project: { definitions: [], errors: [] },
  }));
  return createToolDeps({ registry });
}
