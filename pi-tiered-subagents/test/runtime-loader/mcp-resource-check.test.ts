/**
 * The MCP resource check, run as part of the package suite.
 *
 * Pi's built-in MCP extension loads its client through its own module graph,
 * which Vitest's transform pipeline does not reproduce, so the check runs in a
 * real process. This test fails if that process fails, so the guarantee is part
 * of `nx test` and not only of the separate `mcp-check` target.
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const packageRoot = resolve(import.meta.dirname, "..", "..");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

it("a resource-only child reads from a live stdio MCP server", async () => {
  const result = await new Promise<{ code: number | null; output: string }>(
    (done, fail) => {
      const child = spawn(`${pnpmCommand} exec tsx scripts/mcp-check.mts`, {
        cwd: packageRoot,
        shell: true,
      });
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        output += String(chunk);
      });
      child.once("error", fail);
      child.once("exit", (code) => done({ code, output }));
    },
  );

  expect(result.output, result.output).toContain(
    "mcp-check: a real stdio MCP server served a resource-only child",
  );
  expect(result.code).toBe(0);
}, 60_000);
