import { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { rootPackResourceReducer } from "./pack";

function createTestContext(
  ctx: Partial<ExtensionCommandContext> | { ui: Partial<ExtensionCommandContext["ui"]> },
) {
  return ctx as unknown as ExtensionCommandContext;
}

describe("Pack", () => {
  describe("Testing rootPackResourceReducer", () => {});
  describe.todo("Testing skillPackResourceReducer", () => {});
  describe.todo("Testing agentPackResourceReducer", () => {});
  describe.todo("Testing promptPackResourceReducer", () => {});
});
