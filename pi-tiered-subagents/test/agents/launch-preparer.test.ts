import { describe, expect, it } from "vitest";
import type { AgentDefinition } from "#src/agents/definition";
import { defaultDefinition } from "#src/agents/definition";
import type { AgentDefinitionLookup } from "#src/agents/registry";
import { AgentRegistry } from "#src/agents/registry";
import { LaunchPreparer } from "#src/agents/launch-preparer";
import type { ModelInfo, TurnSettings } from "#src/agents/resolver";
import { DEFAULT_WRAP_UP_TURNS } from "#src/lifecycle/turn-limits";

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
});
