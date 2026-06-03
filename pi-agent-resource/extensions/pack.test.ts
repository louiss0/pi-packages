import {
  type ExtensionCommandContext,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Component, TUI } from "@earendil-works/pi-tui";
import { getCreatePackResourceSelector, rootPackResourceReducer } from "./pack";

type MockContext =
  | Partial<ExtensionCommandContext>
  | { ui: Partial<ExtensionCommandContext["ui"]> };

function createTestContext(ctx: MockContext) {
  return ctx as unknown as ExtensionCommandContext;
}

const getMockCreatePackResourceSelector = (choices: ReadonlyArray<string>) => {
  return vi.fn(
    (
      _tui: TUI,
      _theme: Theme,
      _: KeybindingsManager,
      done: (result?: typeof choices) => void,
    ) => {
      return {
        invalidate: vi.fn(),
        handleInput: vi.fn(() => done(choices)),
        render: vi.fn(),
      };
    },
  ) satisfies ReturnType<typeof getCreatePackResourceSelector<typeof choices>>;
};

const mockCustomUIFactory = async <T>(
  factory: (
    tui: TUI,
    theme: Theme,
    _: KeybindingsManager,
    done: (result?: T) => void,
  ) => Component | Promise<Component>,
) => {
  let value;

  const result = await factory({} as TUI, {} as Theme, {} as KeybindingsManager, (result) => {
    value = result;
  });

  result.handleInput?.("data");

  return value as never;
};

describe("Pack", () => {
  describe("Testing rootPackResourceReducer", () => {
    it("creates a pack when create is passed in", () => {
      const output = "front-end";
      const selectionChoices = ["prompts", "skills", "agents"] as const;

      const ctx = {
        ui: {
          input: vi.fn().mockResolvedValue(output),
          notify: vi.fn(),
          custom: vi.fn(mockCustomUIFactory),
        },
      } satisfies MockContext;

      const mockCreatePackResourceSelector =
        getMockCreatePackResourceSelector(selectionChoices);

      rootPackResourceReducer("create", {
        ctx: createTestContext(ctx),
        createPackResourceSelector: mockCreatePackResourceSelector,
      });

      expect(ctx.ui.input).toHaveBeenCalledWith("pack", "What is the name of your agent pack?");

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        `Pack created successfully with name '${output}'`,
      );

      expect(ctx.ui.custom).toHaveBeenCalledWith(mockCreatePackResourceSelector);
    });

    it("deletes a pack when delete is passed in", () => {
      const output = "C#";

      const ctx = {
        ui: {
          input: vi.fn(async () => output),
          notify: vi.fn(),
        },
      };
      rootPackResourceReducer("delete", { ctx: createTestContext(ctx) });

      expect(ctx.ui.input).toHaveBeenCalledWith(
        "pack",
        "What is the name of the pack you want to delete?",
      );

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        `Pack deleted successfully with name '${output}'`,
      );
    });
  });
  describe.todo("Testing skillPackResourceReducer", () => {});
  describe.todo("Testing agentPackResourceReducer", () => {});
  describe.todo("Testing promptPackResourceReducer", () => {});
});
