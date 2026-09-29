import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("Pi extension package metadata", () => {
  it("uses the host-provided TypeBox instead of installing a second copy", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );

    expect(manifest.dependencies).not.toHaveProperty("@sinclair/typebox");
    expect(manifest.peerDependencies).toHaveProperty("@sinclair/typebox", "*");
  });
});
