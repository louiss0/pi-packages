import { describe, expect, it, vi } from "vitest";
import type { LoadedScopes } from "#src/agents/loader";
import { LaunchPreparer } from "#src/agents/launch-preparer";
import type { ChildShapingSettings } from "#src/agents/launch-preparer";
import type { ModelInfo, TurnSettings } from "#src/agents/resolver";
import { DEFAULT_WRAP_UP_TURNS } from "#src/lifecycle/turn-limits";
import { makeReasoningModel } from "#test/helpers/make-model";

const modelInfo: ModelInfo = {
  ladders: { profiles: new Map(), strategies: new Map() },
};

/** One scope holding a single definition patch. */
function scopesWith(
  definitions: LoadedScopes["global"]["definitions"],
): LoadedScopes {
  return {
    global: { definitions, errors: [] },
    project: { definitions: [], errors: [] },
  };
}

function workerScopes(): LoadedScopes {
  return scopesWith([{ id: "worker", patch: {}, path: "worker.md" }]);
}

function makePreparer(
  loadScopes: (() => LoadedScopes) | LoadedScopes = workerScopes,
  options: {
    modelInfo?: () => ModelInfo;
    turnSettings?: () => TurnSettings;
    childShaping?: () => ChildShapingSettings;
  } = {},
): LaunchPreparer {
  return new LaunchPreparer({
    loadScopes: async () =>
      typeof loadScopes === "function" ? loadScopes() : loadScopes,
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
  it("rejects an unknown requested agent instead of synthesizing a definition", async () => {
    const outcome = await makePreparer().prepare(request({ type: "missing" }));

    expect(outcome).toEqual({
      kind: "rejected",
      reason: "unknown-agent",
      message: expect.stringContaining('Unknown agent type "missing"'),
    });
  });

  it("preserves the disabled-agent distinction", async () => {
    const outcome = await makePreparer(
      scopesWith([{ id: "worker", patch: { enabled: false }, path: "w.md" }]),
    ).prepare(request());

    expect(outcome).toMatchObject({
      kind: "rejected",
      reason: "disabled-agent",
      message: 'Agent "worker" is disabled.',
    });
  });

  it("rejects invalid thinking at the shared boundary", async () => {
    expect(
      await makePreparer().prepare(request({ thinking: "turbo" })),
    ).toMatchObject({ kind: "rejected", reason: "invalid-thinking" });
  });

  it("captures model identity and reasoning as owned launch values", async () => {
    const parentModel = makeReasoningModel({
      provider: "anthropic",
      id: "claude-sonnet-5",
    });
    const registry = {
      find: () => parentModel,
      getAll: () => [parentModel],
      getAvailable: () => [parentModel],
    };
    const outcome = await makePreparer(workerScopes(), {
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

  it("copies routing model inputs before definition loading can mutate them", async () => {
    const parentModel = makeReasoningModel({
      provider: "anthropic",
      id: "claude-sonnet-5",
    });
    const registry = {
      find: (provider: string, id: string) =>
        provider === "anthropic" && id === "claude-sonnet-5"
          ? parentModel
          : undefined,
      getAll: () => [parentModel],
      getAvailable: () => [parentModel],
    };
    const preparer = new LaunchPreparer({
      loadScopes: async () => {
        // This is the asynchronous gap a queued request crosses. A live SDK
        // model object must not rewrite the routing decision after capture.
        Object.assign(parentModel, { id: "replacement" });
        return workerScopes();
      },
      modelInfo: () => ({
        parentModel,
        modelRegistry: registry,
        ladders: { profiles: new Map(), strategies: new Map() },
      }),
      turnSettings: () => ({
        defaultMaxTurns: undefined,
        wrapUpTurns: DEFAULT_WRAP_UP_TURNS,
      }),
      childShaping: () => ({
        midRunUpdates: true,
        excludedExtensionPackages: [],
        promptInheritance: {},
      }),
    });

    const outcome = await preparer.prepare(
      request({ model: "anthropic/claude-sonnet-5" }),
    );

    expect(outcome).toMatchObject({ kind: "prepared" });
    if (outcome.kind === "prepared") {
      expect(outcome.value.config.execution.modelIdentity).toEqual({
        provider: "anthropic",
        id: "claude-sonnet-5",
      });
    }
  });

  it("captures the operator turn defaults before the definition load yields", async () => {
    let turnSettings: TurnSettings = {
      defaultMaxTurns: 8,
      wrapUpTurns: 3,
    };
    const order: string[] = [];
    const preparer = new LaunchPreparer({
      loadScopes: async () => {
        order.push("load");
        // A settings edit lands while the load is in flight; the request must
        // keep the values from when it was made.
        turnSettings = { defaultMaxTurns: 20, wrapUpTurns: 5 };
        return workerScopes();
      },
      modelInfo: () => modelInfo,
      turnSettings: () => {
        order.push("settings");
        return turnSettings;
      },
      childShaping: () => ({
        midRunUpdates: true,
        excludedExtensionPackages: [],
        promptInheritance: {},
      }),
    });

    const outcome = await preparer.prepare(request());

    expect(order).toEqual(["settings", "load"]);
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

  it("copies definition tool capabilities so a later catalog mutation cannot widen the plan", async () => {
    const names = ["read"];
    const outcome = await makePreparer(
      scopesWith([
        {
          id: "worker",
          patch: { tools: { kind: "explicit" as const, names } },
          path: "worker.md",
        },
      ]),
    ).prepare(request());
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

  it("captures child-shaping settings so later edits reach only the next launch", async () => {
    let captured: ChildShapingSettings = {
      midRunUpdates: true,
      excludedExtensionPackages: ["old-package"],
      promptInheritance: { anthropic: "portable" as const },
    };
    const preparer = makePreparer(workerScopes(), {
      childShaping: () => captured,
    });

    const outcome = await preparer.prepare(request());
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

  it("gives each preparation its own catalog, unaffected by a concurrent reload", async () => {
    // The definition files change between two overlapping preparations; each
    // request still selects from the scopes loaded for it.
    let disabled = false;
    const preparer = new LaunchPreparer({
      loadScopes: async () =>
        scopesWith([
          {
            id: "worker",
            patch: disabled ? { enabled: false } : {},
            path: "worker.md",
          },
        ]),
      modelInfo: () => modelInfo,
      turnSettings: () => ({
        defaultMaxTurns: undefined,
        wrapUpTurns: DEFAULT_WRAP_UP_TURNS,
      }),
      childShaping: () => ({
        midRunUpdates: true,
        excludedExtensionPackages: [],
        promptInheritance: {},
      }),
    });

    const firstPromise = preparer.prepare(request());
    disabled = true;
    const secondPromise = preparer.prepare(request());
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first).toMatchObject({ kind: "prepared" });
    expect(second).toMatchObject({
      kind: "rejected",
      reason: "disabled-agent",
    });
  });

  it("rejects without loading when the signal is already aborted", async () => {
    const loadScopes = vi.fn(async () => workerScopes());
    const preparer = new LaunchPreparer({
      loadScopes,
      modelInfo: () => modelInfo,
      turnSettings: () => ({
        defaultMaxTurns: undefined,
        wrapUpTurns: DEFAULT_WRAP_UP_TURNS,
      }),
      childShaping: () => ({
        midRunUpdates: true,
        excludedExtensionPackages: [],
        promptInheritance: {},
      }),
    });
    const controller = new AbortController();
    controller.abort();

    const outcome = await preparer.prepare(request(), controller.signal);

    expect(outcome).toMatchObject({ kind: "rejected", reason: "cancelled" });
    expect(loadScopes).not.toHaveBeenCalled();
  });

  it("rejects when cancellation lands during the definition load", async () => {
    const controller = new AbortController();
    const preparer = new LaunchPreparer({
      loadScopes: () =>
        new Promise<LoadedScopes>((resolve) => {
          controller.abort();
          resolve(workerScopes());
        }),
      modelInfo: () => modelInfo,
      turnSettings: () => ({
        defaultMaxTurns: undefined,
        wrapUpTurns: DEFAULT_WRAP_UP_TURNS,
      }),
      childShaping: () => ({
        midRunUpdates: true,
        excludedExtensionPackages: [],
        promptInheritance: {},
      }),
    });

    const outcome = await preparer.prepare(request(), controller.signal);

    expect(outcome).toMatchObject({ kind: "rejected", reason: "cancelled" });
  });
});
