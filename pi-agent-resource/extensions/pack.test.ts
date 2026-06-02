import { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { rootPackResourceReducer } from "./pack";

function createTestContext(
  ctx: Partial<ExtensionCommandContext> | { ui: Partial<ExtensionCommandContext["ui"]> },
) {
  return ctx as unknown as ExtensionCommandContext;
}

describe("Pack", () => {
  describe("Testing rootPackResourceReducer", () => {
    it("creates a pack when create is passed in", () => {
      const output = "front-end";

      const ctx = createTestContext({
        ui: {
          input: vi.fn(async () => output),
          notify: vi.fn(),
        },
      });
      rootPackResourceReducer("create", ctx);

      expect(ctx.ui.input).toHaveBeenCalledWith("pack", "What is the name of your agent pack?");

      expect(ctx.ui.input).toHaveResolvedWith(output);

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        `Pack created successfully with name '${output}'`,
      );
    });

    it("deletes a pack when delete is passed in", () => {
      const output = "C#";

      const ctx = createTestContext({
        ui: {
          input: vi.fn(async () => output),
          notify: vi.fn(),
        },
      });
      rootPackResourceReducer("delete", ctx);

      expect(ctx.ui.input).toHaveBeenCalledWith(
        "pack",
        "What is the name of the pack you want to delete?",
      );

      expect(ctx.ui.input).toHaveResolvedWith(output);

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        `Pack deleted successfully with name '${output}'`,
      );
    });
  });
  describe.todo("Testing skillPackResourceReducer", () => {});
  describe.todo("Testing agentPackResourceReducer", () => {});
  describe.todo("Testing promptPackResourceReducer", () => {});
});
