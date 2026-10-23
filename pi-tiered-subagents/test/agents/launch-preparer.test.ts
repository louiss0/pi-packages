import { describe, expect, it } from "vitest";
import type { AgentDefinition } from "#src/agents/definition";
import { defaultDefinition } from "#src/agents/definition";
import type { AgentDefinitionLookup } from "#src/agents/registry";
import { AgentRegistry } from "#src/agents/registry";
import { LaunchPreparer } from "#src/agents/launch-preparer";
import type { ChildShapingSettings } from "#src/agents/launch-preparer";
import type { ModelInfo, TurnSettings } from "#src/agents/resolver";
import { DEFAULT_WRAP_UP_TURNS } from "#src/lifecycle/turn-limits";
import { makeReasoningModel } from "#test/helpers/make-model";

const modelInfo: ModelInfo = {
  ladders: { profiles: new Map(), strategies: new Map() },
};

function registryWithWorker(): AgentRegistry {
  return new AgentRegistry(() => ({
    global: { definitions: [], errors: [] },
    project: { definitions: [], errors: [] },
  }));
}

function makePreparer(
  registry: AgentDefinitionLookup,
  options: {
    reload?: () => void;
    modelInfo?: () => ModelInfo;
    turnSettings?: () => TurnSettings;
    childShaping?: () => ChildShapingSettings;
  } = {},
): LaunchPreparer {
  return new LaunchPreparer({
    registry,
    reload: options.reload ?? (() => {}),
    modelInfo: options.modelInfo ?? (() => modelInfo),
    turnSettings:
      options.turnSettings ??
      (() => ({
        defaultMaxTurns: undefined,
        wrapUpTurns: DEFAULT_WRAP_UP_TURNS,
      })),
    childShaping:
      options.childShaping ??
      (() => ({
        midRunUpdates: true,
        excludedExtensionPackages: [],
        promptInheritance: {},
      })),
  });
}

function request(
  overrides: Partial<{
    type: string;
    prompt: string;
    description: string;
    model: string;
    thinking: string;
    maxTurns: number;
    inheritContext: boolean;
    runInBackground: boolean;
  }> = {},
) {
  return { type: "worker", prompt: "do it", ...overrides };
}

describe("LaunchPreparer", () => {
  it("rejects an unknown requested agent instead of synthesizing a definition", () => {
    const registry = registryWithWorker();
    const outcome = makePreparer(registry).prepare(
      request({ type: "missing" }),
    );

    expect(outcome).toEqual({
      kind: "rejected",
      reason: "unknown-agent",
      message: expect.stringContaining('Unknown agent type "missing"'),
    });
  });

  it("preserves the registry's disabled-agent distinction", () => {
    const registry = new AgentRegistry(() => ({
      global: {
        definitions: [
          { id: "worker", patch: { enabled: false }, path: "worker.md" },
        ],
        errors: [],
      },
      project: { definitions: [], errors: [] },
    }));

    expect(makePreparer(registry).prepare(request())).toMatchObject({
      kind: "rejected",
      reason: "disabled-agent",
      message: 'Agent "worker" is disabled.',
    });
  });

  it("rejects invalid thinking at the shared boundary", () => {
    expect(
      makePreparer(registryWithWorker()).prepare(
        request({ thinking: "turbo" }),
      ),
    ).toMatchObject({ kind: "rejected", reason: "invalid-thinking" });
  });

  it("captures model identity and reasoning as owned launch values", () => {
    const parentModel = makeReasoningModel({
      provider: "anthropic",
      id: "claude-sonnet-5",
    });
    const registry = {
      find: () => parentModel,
      getAll: () => [parentModel],
      getAvailable: () => [parentModel],
    };
    const outcome = makePreparer(registryWithWorker(), {
      modelInfo: () => ({
        parentModel,
        modelRegistry: registry,
        ladders: { profiles: new Map(), strategies: new Map() },
        parentThinkingLevel: "high",
      }),
    }).prepare(
      request({ model: "anthropic/claude-sonnet-5", thinking: "off" }),
    );

    expect(outcome.kind).toBe("prepared");
    if (outcome.kind === "prepared") {
      expect(outcome.value.config.execution.modelIdentity).toEqual({
        provider: "anthropic",
        id: "claude-sonnet-5",
      });
      expect(outcome.value.config.execution).not.toHaveProperty("model");
      expect(outcome.value.config.execution.thinkingDecision).toMatchObject({
        applicable: true,
        clamped: true,
      });

      // Mutating the SDK object after preparation cannot alter either fact.
      Object.assign(parentModel, { id: "replacement", reasoning: false });
      expect(outcome.value.config.execution.modelIdentity).toEqual({
        provider: "anthropic",
        id: "claude-sonnet-5",
      });
      expect(outcome.value.config.execution.thinkingDecision).toMatchObject({
        applicable: true,
        clamped: true,
      });
    }
  });

  it("captures the operator turn defaults into the prepared decision", () => {
    const registry = registryWithWorker();
    let turnSettings: TurnSettings = {
      defaultMaxTurns: 8,
      wrapUpTurns: 3,
    };
    const preparer = makePreparer(registry, {
      turnSettings: () => turnSettings,
    });

    const outcome = preparer.prepare(request());
    turnSettings = { defaultMaxTurns: 20, wrapUpTurns: 5 };

    expect(outcome).toMatchObject({
      kind: "prepared",
      value: {
        config: {
          execution: {
            turnPolicy: { kind: "limited", maxTurns: 8, wrapUpTurns: 3 },
          },
        },
      },
    });
  });

  it("copies definition tool capabilities so a later catalog mutation cannot widen the plan", () => {
    const names = ["read"];
    const definition: AgentDefinition = {
      ...defaultDefinition("worker", "shipped"),
      tools: { kind: "explicit", names },
    };
    const registry: AgentDefinitionLookup = {
      select: () => ({ ok: true, definition }),
      find: () => definition,
      list: () => [definition],
    };
    const outcome = makePreparer(registry).prepare(request());
    names.push("bash");

    expect(outcome.kind).toBe("prepared");
    if (outcome.kind === "prepared") {
      expect(outcome.value.definition.tools).toEqual({
        kind: "explicit",
        names: ["read"],
      });
      expect(outcome.value.config.identity.definition.tools).toEqual({
        kind: "explicit",
        names: ["read"],
      });
    }
  });

  it("captures child-shaping settings so later edits reach only the next launch", () => {
    const registry = registryWithWorker();
    let captured: ChildShapingSettings = {
      midRunUpdates: true,
      excludedExtensionPackages: ["old-package"],
      promptInheritance: { anthropic: "portable" as const },
    };
    const preparer = makePreparer(registry, {
      childShaping: () => captured,
    });

    const outcome = preparer.prepare(request());
    captured = {
      midRunUpdates: false,
      excludedExtensionPackages: ["new-package"],
      promptInheritance: {},
    };

    expect(outcome.kind).toBe("prepared");
    if (outcome.kind === "prepared") {
      expect(outcome.value.childShaping).toEqual({
        midRunUpdates: true,
        excludedExtensionPackages: ["old-package"],
        promptInheritance: { anthropic: "portable" },
      });
    }
  });
});
