/**
 * Story 109: runtime/loader compatibility gate for explicit resource
 * management (`using` / `await using`, dispose symbols).
 *
 * A TypeScript compile alone is insufficient evidence (ARCHITECTURE-SPEC
 * Testing Decisions 22): Pi ships and loads TypeScript source through its own
 * loader (jiti's Babel transform), so adoption is gated on a real load/disposal
 * probe. This test loads two modules through Pi's public loader
 * (`discoverAndLoadExtensions`, the same path ui-registration.test.ts uses):
 *
 *   1. fixtures/erm-probe-extension.ts — exercises `using` and `await using`
 *      in nested and throwing scopes, recording disposal order.
 *   2. The package's real source entry (extensions/index.ts), which since
 *      story 109 contains `using` in src/lifecycle/subagent-session.ts —
 *      proving the adopted syntax survives the real loader end to end.
 *
 * No extension-factory or loader mocks.
 */
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  discoverAndLoadExtensions,
  ExtensionRunner,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { ExtensionError } from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readErmProbeRecord } from "./fixtures/erm-probe-extension";

const fixtureEntry = fileURLToPath(
  new URL("./fixtures/erm-probe-extension.ts", import.meta.url),
);
const realEntry = fileURLToPath(
  new URL("../../extensions/index.ts", import.meta.url),
);

describe("explicit resource management under Pi's real loader", () => {
  let directory: string;
  let runner: ExtensionRunner | undefined;
  const errors: ExtensionError[] = [];
  let loadedPaths: string[] = [];
  let loadErrors: string[] = [];

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "pi-erm-probe-"));
    const agentDir = join(directory, "agent");
    await mkdir(agentDir);
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    // The extension's settings use the host process cwd, as a real Pi launch
    // does. Isolate that factory-time capture without changing the process cwd.
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(directory);
    try {
      const models = await ModelRuntime.create({
        authPath: join(agentDir, "auth.json"),
        modelsPath: null,
        allowModelNetwork: false,
        refreshOnCreate: false,
      });
      const loaded = await discoverAndLoadExtensions(
        [fixtureEntry, realEntry],
        directory,
        agentDir,
      );
      loadErrors = loaded.errors.map((error) => error.error);
      loadedPaths = loaded.extensions.map(
        (extension) => extension.resolvedPath,
      );
      const sessions = SessionManager.inMemory(directory);
      runner = new ExtensionRunner(
        loaded.extensions,
        loaded.runtime,
        directory,
        sessions,
        new ModelRegistry(models),
      );
      runner.onError((error) => errors.push(error));
    } finally {
      cwd.mockRestore();
    }
  }, 30_000);

  afterAll(async () => {
    try {
      if (runner) {
        await runner.emit({ type: "session_shutdown", reason: "quit" });
        expect(errors).toEqual([]);
      }
    } finally {
      runner?.invalidate();
      vi.unstubAllEnvs();
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  });

  it("the runtime provides dispose symbols natively (no polyfill needed)", () => {
    // Node >= 22.19 (Pi's declared floor) ships both symbols; the Babel
    // transform lowers `using` onto them directly.
    expect(typeof Symbol.dispose).toBe("symbol");
    expect(typeof Symbol.asyncDispose).toBe("symbol");
  });

  it("loads a module using `using` / `await using` with no load errors", () => {
    expect(loadErrors).toEqual([]);
    expect(loadedPaths).toEqual([fixtureEntry, realEntry]);
  });

  it("runs sync disposal in reverse lexical order, including on the throw path", () => {
    const record = readErmProbeRecord();
    expect(record).toBeDefined();
    expect(record?.syncEvents).toEqual([
      "body:outer",
      "body:inner",
      "dispose:inner",
      "after:inner",
      "dispose:thrown",
      "caught",
      "dispose:outer",
      "after:outer",
    ]);
  });

  it("runs async disposal in reverse lexical order", () => {
    const record = readErmProbeRecord();
    expect(record?.asyncEvents).toEqual([
      "body:first",
      "body:second",
      "dispose:second",
      "after:second",
      "dispose:first",
      "after:first",
    ]);
  });

  it("loads the package's real source entry, which now contains `using`", () => {
    // extensions/index.ts transitively imports src/lifecycle/subagent-session.ts,
    // where story 109 adopted `using` for the prompt bracket's temporary
    // subscriptions. A clean load here is the end-to-end adoption evidence.
    expect(loadedPaths).toContain(realEntry);
    expect(loadErrors).toEqual([]);
  });
});
