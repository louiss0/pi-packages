import { join } from "node:path";
import { detectAgentRuntimes } from "./agent-runtime-detection";

describe("runtime detection", () => {
  const tinted = JSON.stringify({ name: "@tintinweb/pi-subagents", repository: { url: "https://github.com/tintinweb/pi-subagents.git" } });
  const nico = JSON.stringify({ name: "pi-subagents", repository: { url: "git+https://github.com/nicobailon/pi-subagents.git" } });
  const source = (path: string) => ({ sourceInfo: { path, source: "package" } });
  function reader(files: Record<string, string>) {
    return vi.fn(async (path: string) => {
      if (!(path in files)) throw new Error("not found");
      return files[path];
    });
  }
  it("uses passive package manifest provenance", async () => {
    const read = reader({ [join("/packages/tintin", "package.json")]: tinted });
    expect(await detectAgentRuntimes([source("/packages/tintin/src/index.ts")], read)).toEqual(["tintin"]);
  });
  it("recognizes both implementations without conflating their similar names", async () => {
    const read = reader({ [join("/packages/tintin", "package.json")]: tinted, [join("/packages/nico", "package.json")]: nico });
    expect(await detectAgentRuntimes([source("/packages/tintin/index.ts"), source("/packages/nico/index.ts")], read)).toEqual(["nico", "tintin"]);
  });
  it("does not infer identity from names, missing metadata, or synthetic SDK tools", async () => {
    const read = reader({});
    expect(await detectAgentRuntimes([{}, { sourceInfo: { path: "<sdk:Agent>", source: "sdk" } }], read)).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });
  it("does not classify an unrelated same-named package as Nico", async () => {
    const read = reader({ [join("/packages/other", "package.json")]: JSON.stringify({ name: "pi-subagents", repository: "https://github.com/other/pi-subagents" }) });
    expect(await detectAgentRuntimes([source("/packages/other/index.ts")], read)).toEqual([]);
  });
  it("treats corrupt or unreadable manifests as ambiguous", async () => {
    expect(await detectAgentRuntimes([source("/packages/bad/index.ts")], reader({ [join("/packages/bad", "package.json")]: "{broken" }))).toEqual([]);
  });
});
