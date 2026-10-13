import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Mock } from "vitest";
import { authorAgentDefinition, isSafeAgentFilename } from "./agent-authoring";
import type { AgentFrontmatter } from "./agent-contracts";

function uiWith(choices: Array<string | undefined> = []) {
  return {
    select: vi.fn(async () => choices.shift()),
    editor: vi.fn(
      async (): Promise<string | undefined> =>
        "Write a focused report.\nKeep Markdown.",
    ),
    notify: vi.fn(),
    confirm: vi.fn(async () => true),
    custom: vi.fn(async <T>() => undefined as T) as Mock<
      ExtensionContext["ui"]["custom"]
    > &
      ExtensionContext["ui"]["custom"],
  };
}
const essentials: AgentFrontmatter = {
  name: "reviewer",
  description: "Review the code thoroughly and report any problems",
  tools: "read,grep",
  model: "claude",
};
function metadata(
  frontmatter: AgentFrontmatter = essentials,
  advanced = false,
) {
  return { frontmatter, advanced, filename: "reviewer" };
}

describe("form-based agent authoring", () => {
  it.each([
    "../escape",
    "a/b",
    "a\\b",
    ".hidden",
    "nul",
    "COM1",
    "a.md",
    "",
    "name:plugin",
  ])("rejects unsafe filename %s", (name) =>
    expect(isSafeAgentFilename(name)).toBe(false));
  it("keeps safe filenames independent of dispatch names", () => {
    expect(isSafeAgentFilename("Mixed_Case-1")).toBe(true);
  });
  it.each([
    "tintin",
    "nico",
  ] as const)("starts %s creation with the metadata form, then opens the prompt automatically", async (runtime) => {
    const ui = uiWith();
    ui.custom.mockResolvedValueOnce(metadata());
    const result = await authorAgentDefinition(
      ui,
      runtime,
      { frontmatter: {}, body: "" },
      ["read", "write", "edit"],
      "create",
    );
    expect(result).toEqual({
      frontmatter: essentials,
      body: "Write a focused report.\nKeep Markdown.",
      filename: "reviewer",
    });
    expect(ui.custom).toHaveBeenCalledOnce();
    expect(ui.select).not.toHaveBeenCalled();
    expect(ui.editor).toHaveBeenCalledExactlyOnceWith(
      "Agent system prompt (Markdown body only)",
      "",
    );
    expect(ui.custom.mock.invocationCallOrder[0]).toBeLessThan(
      ui.editor.mock.invocationCallOrder[0],
    );
  });
  it.each([
    [{ ...essentials, name: "Mixed" }, "Name must be lowercase"],
    [
      { ...essentials, description: "short" },
      "Description must be at least 35",
    ],
    [{ ...essentials, tools: "Read,write" }, "Tools must be a comma-separated"],
    [{ ...essentials, model: "Claude" }, "Model must be lowercase"],
    [{}, "Tools are required"],
  ])("does not open the prompt until the essentials are valid", async (frontmatter, message) => {
    const ui = uiWith();
    ui.custom.mockResolvedValueOnce(metadata(frontmatter));
    expect(
      await authorAgentDefinition(
        ui,
        "tintin",
        { frontmatter: {}, body: "" },
        [],
        "create",
      ),
    ).toBeUndefined();
    expect(ui.editor).not.toHaveBeenCalled();
    expect(ui.notify).toHaveBeenCalledWith(
      expect.stringContaining(message),
      "error",
    );
  });
  it("fills advanced sections before opening the prompt, with no field/type menus", async () => {
    const ui = uiWith(["Identity", "Done"]);
    ui.custom
      .mockResolvedValueOnce(metadata(essentials, true))
      .mockResolvedValueOnce({ ...essentials, enabled: false });
    const result = await authorAgentDefinition(ui, "tintin", {
      frontmatter: essentials,
      body: "Prompt",
    });
    expect(result?.frontmatter).toEqual({ ...essentials, enabled: false });
    expect(ui.custom).toHaveBeenCalledTimes(2);
    expect(ui.select).toHaveBeenCalledTimes(2);
    expect(ui.custom.mock.invocationCallOrder[1]).toBeLessThan(
      ui.editor.mock.invocationCallOrder[0],
    );
  });
  it("keeps existing settings when an optional section is cancelled", async () => {
    const ui = uiWith(["Identity", "Done"]);
    const initial = { ...essentials, enabled: false };
    ui.custom
      .mockResolvedValueOnce(metadata(initial, true))
      .mockResolvedValueOnce(null);
    expect(
      (
        await authorAgentDefinition(ui, "tintin", {
          frontmatter: initial,
          body: "Prompt",
        })
      )?.frontmatter,
    ).toEqual(initial);
  });
  it("omits advanced settings only when the section form returns them omitted", async () => {
    const ui = uiWith(["Context", "Done"]);
    const initial = { ...essentials, skills: "review" };
    ui.custom
      .mockResolvedValueOnce(metadata(initial, true))
      .mockResolvedValueOnce(essentials);
    expect(
      (
        await authorAgentDefinition(ui, "tintin", {
          frontmatter: initial,
          body: "Prompt",
        })
      )?.frontmatter,
    ).toEqual(essentials);
    expect(initial.skills).toBe("review");
  });
  it("cancels when the metadata form or the prompt editor is dismissed", async () => {
    expect(
      await authorAgentDefinition(uiWith(), "tintin", {
        frontmatter: essentials,
        body: "Prompt",
      }),
    ).toBeUndefined();
    const ui = uiWith();
    ui.custom.mockResolvedValueOnce(metadata());
    ui.editor.mockResolvedValueOnce(undefined);
    expect(
      await authorAgentDefinition(ui, "tintin", {
        frontmatter: essentials,
        body: "Prompt",
      }),
    ).toBeUndefined();
    expect(ui.confirm).not.toHaveBeenCalled();
  });
  it("requires an intentional-empty-prompt confirmation", async () => {
    const ui = uiWith();
    ui.custom.mockResolvedValueOnce(metadata());
    ui.editor.mockResolvedValueOnce("");
    ui.confirm.mockResolvedValueOnce(false);
    expect(
      await authorAgentDefinition(ui, "tintin", {
        frontmatter: essentials,
        body: "Prompt",
      }),
    ).toBeUndefined();
    expect(ui.confirm).toHaveBeenCalledExactlyOnceWith(
      "Empty system prompt",
      expect.any(String),
    );
  });
  it("returns to the metadata form when review is declined", async () => {
    const ui = uiWith();
    ui.custom
      .mockResolvedValueOnce(metadata())
      .mockResolvedValueOnce(metadata());
    ui.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect(
      await authorAgentDefinition(ui, "tintin", {
        frontmatter: essentials,
        body: "Prompt",
      }),
    ).toBeDefined();
    expect(ui.custom).toHaveBeenCalledTimes(2);
    expect(ui.editor).toHaveBeenCalledTimes(2);
  });
  it("keeps unchanged legacy definitions readable but rejects changed legacy prompts", async () => {
    const initial = {
      frontmatter: { name: "MixedCase", description: "Brief" },
      body: "Original prompt",
    };
    const unchanged = uiWith();
    unchanged.custom.mockResolvedValueOnce(metadata(initial.frontmatter));
    unchanged.editor.mockResolvedValueOnce(initial.body);
    expect(await authorAgentDefinition(unchanged, "tintin", initial)).toEqual(
      initial,
    );
    const changed = uiWith();
    changed.custom.mockResolvedValueOnce(metadata(initial.frontmatter));
    expect(
      await authorAgentDefinition(changed, "tintin", initial),
    ).toBeUndefined();
    expect(changed.notify).toHaveBeenCalledWith(
      expect.stringContaining("Tools are required"),
      "error",
    );
    expect(initial.body).toBe("Original prompt");
  });
});
