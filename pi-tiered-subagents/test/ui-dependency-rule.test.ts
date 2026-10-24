import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const workspace = fileURLToPath(new URL("../..", import.meta.url));
const ui = path.join(workspace, "pi-tiered-subagents/src/ui");
const eslint = new ESLint({ cwd: workspace });

async function boundaryMessages(
  code: string,
  filePath = path.join(ui, "boundary-fixture.ts"),
) {
  const results = await eslint.lintText(code, { filePath });
  return results
    .flatMap((result) => result.messages)
    .filter((message) => message.ruleId === "pi-tiered-subagents/ui-boundary");
}

describe("configured UI dependency guard", () => {
  it("rejects a relative import of execution implementation", async () => {
    const messages = await boundaryMessages(
      'import { SubagentManager } from "../lifecycle/subagent-manager";',
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.message).toContain("UI-owned views/actions");
  }, 15000);

  it("rejects a dynamic import of the extension entry point", async () => {
    const messages = await boundaryMessages(
      'void import("/../../extensions/index");',
    );
    expect(messages).toHaveLength(1);
  }, 15000);
});
