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
import { loadSettings, SettingsManager } from "#src/settings";
import { SETTINGS_EXTENSION_NAME } from "#src/shared-settings";
import { toSharedStore } from "#test/helpers/tmp-settings-dirs";

/** A profile as the settings store holds it. */
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
      join(agentDir, "settings-extensions.json"),
      JSON.stringify(
        toSharedStore({ familyProfiles: { claude: CLAUDE_PROFILE } }),
      ),
    );
    writeFileSync(
      join(cwd, ".pi", "settings-extensions.json"),
      JSON.stringify(toSharedStore({ familyProfiles: { gpt: GPT_PROFILE } })),
    );

    const settings = loadSettings(agentDir, cwd, { projectTrusted: true });
    expect(Object.keys(settings.familyProfiles ?? {}).sort()).toEqual([
      "claude",
      "gpt",
    ]);
  });

  it("merges the layers per family, so a project refines one family only", () => {
    writeFileSync(
      join(agentDir, "settings-extensions.json"),
      JSON.stringify(
        toSharedStore({ familyProfiles: { claude: CLAUDE_PROFILE } }),
      ),
    );
    writeFileSync(
      join(cwd, ".pi", "settings-extensions.json"),
      JSON.stringify(toSharedStore({ familyProfiles: { gpt: GPT_PROFILE } })),
    );

    const settings = loadSettings(agentDir, cwd, { projectTrusted: true });
    const profiles = settings.familyProfiles ?? {};
    expect(profiles.claude).toEqual(CLAUDE_PROFILE);
    expect(profiles.gpt).toEqual(GPT_PROFILE);
  });

  it("does not read the project layer when the project is not trusted", () => {
    writeFileSync(
      join(agentDir, "settings-extensions.json"),
      JSON.stringify(
        toSharedStore({ familyProfiles: { claude: CLAUDE_PROFILE } }),
      ),
    );
    writeFileSync(
      join(cwd, ".pi", "settings-extensions.json"),
      JSON.stringify(toSharedStore({ familyProfiles: { gpt: GPT_PROFILE } })),
    );

    const settings = loadSettings(agentDir, cwd, { projectTrusted: false });
    expect(Object.keys(settings.familyProfiles ?? {})).toEqual(["claude"]);
  });

  it("survives a settings save", () => {
    // The settings store is the one place the profiles live, so saving the
    // settings must not erase them.
    writeFileSync(
      join(cwd, ".pi", "settings-extensions.json"),
      JSON.stringify(toSharedStore({ familyProfiles: { gpt: GPT_PROFILE } })),
    );

    const manager = new SettingsManager({ emit: () => {}, cwd, agentDir });
    manager.load(true);
    expect(manager.saveAndNotify("Max concurrency set to 4").level).toBe(
      "info",
    );

    const written = JSON.parse(
      readFileSync(join(cwd, ".pi", "settings-extensions.json"), "utf-8"),
    );
    expect(written[SETTINGS_EXTENSION_NAME].familyProfiles).toEqual(
      JSON.stringify({ gpt: GPT_PROFILE }),
    );
  });

  it("does not copy the operator's families into the project's file", () => {
    // The project declares no families of its own: a save must leave the
    // operator's families where they are, or the project would shadow every
    // later change to them.
    writeFileSync(
      join(agentDir, "settings-extensions.json"),
      JSON.stringify(
        toSharedStore({ familyProfiles: { claude: CLAUDE_PROFILE } }),
      ),
    );

    const manager = new SettingsManager({
      emit: () => {},
      cwd,
      agentDir,
    });
    expect(manager.load(true).familyProfiles).toEqual({
      claude: CLAUDE_PROFILE,
    });
    manager.saveAndNotify("Max concurrency set to 4");

    const written = JSON.parse(
      readFileSync(join(cwd, ".pi", "settings-extensions.json"), "utf-8"),
    );
    expect(written[SETTINGS_EXTENSION_NAME].familyProfiles).toBeUndefined();
  });

  it("keeps a project declaration that is the same as the operator's", () => {
    // The project's own file declares the family, so the project means it —
    // even when the operator declares the very same profile. A save must not
    // drop it: the project would then follow every later change of the
    // operator's.
    writeFileSync(
      join(agentDir, "settings-extensions.json"),
      JSON.stringify(
        toSharedStore({ familyProfiles: { claude: CLAUDE_PROFILE } }),
      ),
    );
    writeFileSync(
      join(cwd, ".pi", "settings-extensions.json"),
      JSON.stringify(
        toSharedStore({ familyProfiles: { claude: CLAUDE_PROFILE } }),
      ),
    );

    const manager = new SettingsManager({ emit: () => {}, cwd, agentDir });
    manager.load(true);
    manager.saveAndNotify("Max concurrency set to 4");

    const written = JSON.parse(
      readFileSync(join(cwd, ".pi", "settings-extensions.json"), "utf-8"),
    );
    expect(written[SETTINGS_EXTENSION_NAME].familyProfiles).toEqual(
      JSON.stringify({ claude: CLAUDE_PROFILE }),
    );
  });

  it("does not erase a project's families when the project is not trusted", () => {
    // The project's file is not read, so nothing in it is known: a save must
    // leave it alone rather than write an empty value over it.
    writeFileSync(
      join(cwd, ".pi", "settings-extensions.json"),
      JSON.stringify(toSharedStore({ familyProfiles: { gpt: GPT_PROFILE } })),
    );

    const manager = new SettingsManager({ emit: () => {}, cwd, agentDir });
    manager.load(false);
    manager.saveAndNotify("Max concurrency set to 4");

    const written = JSON.parse(
      readFileSync(join(cwd, ".pi", "settings-extensions.json"), "utf-8"),
    );
    expect(written[SETTINGS_EXTENSION_NAME].familyProfiles).toEqual(
      JSON.stringify({ gpt: GPT_PROFILE }),
    );
  });

  it("keeps the operator's families when the project declares one of its own", () => {
    writeFileSync(
      join(agentDir, "settings-extensions.json"),
      JSON.stringify(
        toSharedStore({
          familyProfiles: { claude: CLAUDE_PROFILE, gpt: GPT_PROFILE },
        }),
      ),
    );
    writeFileSync(
      join(cwd, ".pi", "settings-extensions.json"),
      JSON.stringify(toSharedStore({ familyProfiles: { gpt: GPT_PROFILE } })),
    );

    const loaded = loadSettings(agentDir, cwd, { projectTrusted: true });
    expect(Object.keys(loaded.familyProfiles ?? {}).sort()).toEqual([
      "claude",
      "gpt",
    ]);
  });
});
