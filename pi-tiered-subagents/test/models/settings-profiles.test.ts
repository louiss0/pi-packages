import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSettings, saveSettings } from "#src/settings";

/** A profile as the settings file holds it. */
const GPT_PROFILE = {
  versions: [
    {
      version: "6.1",
      tiers: [
        {
          tier: "sol",
          models: [{ provider: "openai", id: "gpt-6.1-sol" }],
        },
      ],
    },
  ],
};

const CLAUDE_PROFILE = {
  versions: [
    {
      version: "5.5",
      tiers: [
        {
          tier: "opus",
          models: [{ provider: "anthropic", id: "claude-opus-5-5" }],
        },
      ],
    },
  ],
};

describe("the family profiles in the settings", () => {
  let root: string;
  let agentDir: string;
  let cwd: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pi-tiered-settings-"));
    agentDir = join(root, "agent");
    cwd = join(root, "project");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(join(cwd, ".pi"), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reads the global and the project layers", () => {
    writeFileSync(
      join(agentDir, "subagents.json"),
      JSON.stringify({ familyProfiles: { claude: CLAUDE_PROFILE } }),
    );
    writeFileSync(
      join(cwd, ".pi", "subagents.json"),
      JSON.stringify({ familyProfiles: { gpt: GPT_PROFILE } }),
    );

    const settings = loadSettings(agentDir, cwd, { projectTrusted: true });
    expect(Object.keys(settings.familyProfiles ?? {}).sort()).toEqual([
      "claude",
      "gpt",
    ]);
  });

  it("merges the layers per family, so a project refines one family only", () => {
    writeFileSync(
      join(agentDir, "subagents.json"),
      JSON.stringify({ familyProfiles: { claude: CLAUDE_PROFILE } }),
    );
    writeFileSync(
      join(cwd, ".pi", "subagents.json"),
      JSON.stringify({ familyProfiles: { gpt: GPT_PROFILE } }),
    );

    const settings = loadSettings(agentDir, cwd, { projectTrusted: true });
    const profiles = settings.familyProfiles ?? {};
    expect(profiles.claude).toEqual(CLAUDE_PROFILE);
    expect(profiles.gpt).toEqual(GPT_PROFILE);
  });

  it("does not read the project layer when the project is not trusted", () => {
    writeFileSync(
      join(agentDir, "subagents.json"),
      JSON.stringify({ familyProfiles: { claude: CLAUDE_PROFILE } }),
    );
    writeFileSync(
      join(cwd, ".pi", "subagents.json"),
      JSON.stringify({ familyProfiles: { gpt: GPT_PROFILE } }),
    );

    const settings = loadSettings(agentDir, cwd, { projectTrusted: false });
    expect(Object.keys(settings.familyProfiles ?? {})).toEqual(["claude"]);
  });

  it("survives a settings save", () => {
    // The settings file is the one place the profiles live, so saving the
    // settings must not erase them.
    writeFileSync(
      join(cwd, ".pi", "subagents.json"),
      JSON.stringify({ familyProfiles: { gpt: GPT_PROFILE } }),
    );

    const loaded = loadSettings(agentDir, cwd, { projectTrusted: true });
    expect(saveSettings(loaded, cwd)).toBe(true);

    const written = JSON.parse(
      readFileSync(join(cwd, ".pi", "subagents.json"), "utf-8"),
    );
    expect(written.familyProfiles.gpt).toEqual(GPT_PROFILE);
  });
});
