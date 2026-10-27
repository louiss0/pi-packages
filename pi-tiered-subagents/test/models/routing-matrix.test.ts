/** Documentation evidence, not a substitute for independent router examples. */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { SHIPPED_DEFINITIONS } from "#src/agents/shipped";
import { generateModelMatrix } from "#src/models/matrix";
import { SHIPPED_PROFILES } from "#src/models/profiles";

const DOC = new URL("../../docs/model-matrix.md", import.meta.url);

describe("the routing matrix in docs/model-matrix.md", () => {
  it("matches every generated region, including the role grid and all availability scenarios", async () => {
    const markdown = await readFile(DOC, "utf8");
    const regions = generateModelMatrix();
    expect(regions.map((region) => region.name)).toEqual(["grid", "full"]);
    const documented = [
      ...markdown.matchAll(
        /<!-- model-matrix:([\w-]+):start -->\n([\s\S]*?)\n<!-- model-matrix:\1:end -->/g,
      ),
    ].map((match) => ({ name: match[1], markdown: match[2] }));
    // Compare whole regions, not selected rows: hand edits anywhere in a
    // generated table (including the grid) must fail this evidence check.
    expect(documented).toEqual(regions);
  });

  it("covers the five unpinned shipped specialists and the eight supported families", () => {
    expect(
      SHIPPED_DEFINITIONS.map((definition) => definition.id).sort(),
    ).toEqual(["debug", "explore", "researcher", "reviewer", "worker"]);
    expect(
      SHIPPED_DEFINITIONS.filter(
        (definition) => definition.model !== undefined,
      ),
    ).toEqual([]);
    const grid = generateModelMatrix().find((region) => region.name === "grid");
    expect(
      grid?.markdown
        .split("\n")[0]
        ?.split("|")
        .slice(2, -1)
        .map((value) => value.trim())
        .sort(),
    ).toEqual([
      "claude",
      "deepseek",
      "gemini",
      "glm",
      "gpt",
      "mimo",
      "minimax",
      "qwen",
    ]);
  });

  it("shows retention when the exact version lacks the role target despite all candidates being available", () => {
    const grid = generateModelMatrix().find((region) => region.name === "grid");
    const worker = grid?.markdown
      .split("\n")
      .find((line) => line.startsWith("| `worker` |"));
    // GPT 6.1 has no M rung; Gemini 4 and DeepSeek 4 have no worker class.
    expect(worker).toBe(
      "| `worker` | **retain** | `anthropic/claude-sonnet-5-5` | **retain** | `zai/glm-5.3-flash` | `minimax/MiniMax-M3.1-flash` | `qwen-token-plan/qwen3.7-plus` | **retain** | `xiaomi/mimo-v2.6-flash` |",
    );
  });

  it("documents every concrete parent for every role with all three availability outcomes", () => {
    const full = generateModelMatrix().find((region) => region.name === "full");
    const rows =
      full?.markdown.split("\n").filter((line) => line.startsWith("| `")) ?? [];
    const roles = ["explore", "worker", "reviewer", "debug", "researcher"];
    const expected = SHIPPED_PROFILES.flatMap((profile) =>
      profile.versions.flatMap((version) =>
        version.tiers.flatMap((tier) =>
          tier.models.flatMap((parent) =>
            roles.map((role) => `${parent.provider}/${parent.id}\t${role}`),
          ),
        ),
      ),
    ).sort();
    const documented = rows
      .map((line) => {
        const cells = line
          .split("|")
          .slice(1, -1)
          .map((value) => value.trim());
        expect(cells).toHaveLength(6);
        for (const outcome of cells.slice(3)) {
          expect(outcome).toMatch(/^(\*\*retain\*\*|`[^`]+\/[^`]+`)$/);
        }
        expect(cells[4]).toBe("**retain**");
        expect(cells[5]).toBe("**retain**");
        return `${cells[0]?.replaceAll("`", "")}\t${cells[2]?.replaceAll("`", "")}`;
      })
      .sort();
    expect(documented).toEqual(expected);
  });
});
