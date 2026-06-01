import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_MAX_BYTES } from "@earendil-works/pi-coding-agent";
import { afterEach, vi } from "vitest";

import { truncateBashToolOutput } from "./index";

describe("truncateBashToolOutput", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();

    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("writes truncated output into the command cwd", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "nu-tool-output-"));
    vi.spyOn(Date, "now").mockReturnValue(12345);

    const output = "x".repeat(DEFAULT_MAX_BYTES + 1);
    const expectedPath = join(tempDir, "nu-tool-output_12345.txt");
    const result = await truncateBashToolOutput(output, tempDir);

    expect(result.truncated).toBe(true);
    expect(result.output).toContain(expectedPath);
    await expect(readFile(expectedPath, "utf-8")).resolves.toBe(output);
  });
});
