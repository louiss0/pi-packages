/** The installed package must not expose a runtime control API. */
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const packageName = "@code-fixer-23/pi-tiered-subagents";

describe("package runtime boundary", () => {
  it.each([
    packageName,
    `${packageName}/src/service/service.ts`,
    `${packageName}/src/service/service-adapter.ts`,
    `${packageName}/test/helpers/subagents-driver.ts`,
  ])("does not export %s", (specifier) => {
    expect(() => require.resolve(specifier)).toThrow(
      expect.objectContaining({ code: "ERR_PACKAGE_PATH_NOT_EXPORTED" }),
    );
  });

  it("keeps only the independent settings utility as a public entry", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    );
    expect(manifest.exports).toEqual({
      "./settings": "./src/layered-settings.ts",
    });
    expect(require.resolve(`${packageName}/settings`)).toMatch(
      /layered-settings\.ts$/,
    );
    expect(manifest.files).not.toContain("test");
  });
});
