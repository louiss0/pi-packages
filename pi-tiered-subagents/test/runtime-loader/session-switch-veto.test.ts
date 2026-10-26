/**
 * Pi 1.3.0 session replacement regression.
 *
 * The SDK returns `{ cancelled: true }` from `newSession()` when a
 * `session_before_switch` handler vetoes. It does not emit `session_start`
 * or `session_shutdown` in that path, so the extension must leave its public
 * service owner and accepted launch door usable.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { getSubagentsService } from "#src/service/service";

const packageEntry = fileURLToPath(
  new URL("../../extensions/index.ts", import.meta.url),
);
const vetoEntry = fileURLToPath(
  new URL("./fixtures/veto-session-switch.ts", import.meta.url),
);

interface VetoFixtureControl {
  setVeto(value: boolean): void;
  releaseHeldResponse(): void;
}

const fixtureControlKey = Symbol.for(
  "@code-fixer-23/pi-tiered-subagents:runtime-loader-veto-fixture",
);

function getFixtureControl(): VetoFixtureControl {
  const control = (globalThis as Record<symbol, unknown>)[fixtureControlKey];
  if (!control) throw new Error("veto fixture control was not installed");
  return control as VetoFixtureControl;
}

/** Windows can still hold a session file for a moment after disposal. */
async function removeTempDir(directory: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) {
        // A leftover OS temp directory is not evidence about the behaviour
        // under test, so cleanup never turns a passing assertion into a failure.
        console.warn(`could not remove temp directory ${directory}`, error);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function createFixtureRuntime(directory: string) {
  return createAgentSessionRuntime(
    async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
      const services = await createAgentSessionServices({
        cwd,
        agentDir,
        settingsManager: SettingsManager.inMemory(),
        modelRuntime: await ModelRuntime.create({
          authPath: join(agentDir, "auth.json"),
          modelsPath: null,
          allowModelNetwork: false,
          refreshOnCreate: false,
        }),
        resourceLoaderOptions: {
          additionalExtensionPaths: [packageEntry, vetoEntry],
          noPromptTemplates: true,
          noThemes: true,
          noContextFiles: true,
        },
      });
      const created = await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent: sessionStartEvent ?? {
          type: "session_start",
          reason: "startup",
        },
      });
      await created.session.bindExtensions({});
      return {
        ...created,
        services,
        diagnostics: services.diagnostics,
      };
    },
    {
      cwd: directory,
      agentDir: directory,
      sessionManager: SessionManager.inMemory(directory),
    },
  );
}

describe("Pi 1.3.0 vetoed session replacement", () => {
  const runtimes: Array<{ dispose(): Promise<void> }> = [];

  it("keeps the public launch door usable after a veto", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-session-veto-"));
    try {
      const runtime = await createAgentSessionRuntime(
        async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
          const services = await createAgentSessionServices({
            cwd,
            agentDir,
            settingsManager: SettingsManager.inMemory(),
            modelRuntime: await ModelRuntime.create({
              authPath: join(agentDir, "auth.json"),
              modelsPath: null,
              allowModelNetwork: false,
              refreshOnCreate: false,
            }),
            resourceLoaderOptions: {
              additionalExtensionPaths: [packageEntry, vetoEntry],
              noPromptTemplates: true,
              noThemes: true,
              noContextFiles: true,
            },
          });
          const created = await createAgentSessionFromServices({
            services,
            sessionManager,
            sessionStartEvent: sessionStartEvent ?? {
              type: "session_start",
              reason: "startup",
            },
          });
          await created.session.bindExtensions({});
          return {
            ...created,
            services,
            diagnostics: services.diagnostics,
          };
        },
        {
          cwd: directory,
          agentDir: directory,
          sessionManager: SessionManager.inMemory(directory),
        },
      );
      runtimes.push(runtime);

      const service = getSubagentsService();
      expect(service).toBeDefined();
      if (!service) throw new Error("service did not publish on session start");
      const initial = await service.launch("explore", "offline regression", {
        model: "offline-fixture/offline",
      });
      expect(initial.kind).toBe("accepted");
      if (initial.kind !== "accepted") return;

      await service.waitForAll();
      const beforeSwitch = service.getRecord(initial.id);
      expect(beforeSwitch).toBeDefined();
      expect(beforeSwitch?.status).toMatch(/^(completed|error|stopped)$/);

      const switched = await runtime.newSession();
      expect(switched).toEqual({ cancelled: true });

      const afterSwitch = getSubagentsService();
      expect(afterSwitch).toBe(service);
      if (!afterSwitch) throw new Error("service disappeared after veto");
      expect(afterSwitch.getRecord(initial.id)).toEqual(beforeSwitch);
      const next = await afterSwitch.launch("explore", "still usable", {
        model: "offline-fixture/offline",
      });
      expect(next.kind).toBe("accepted");
      if (next.kind === "accepted") afterSwitch.abort(next.id);
      await afterSwitch.waitForAll();
      expect(afterSwitch.getRecord(initial.id)).toBeDefined();
    } finally {
      for (const candidate of runtimes.splice(0)) await candidate.dispose();
      await removeTempDir(directory);
    }
  }, 30_000);

  it("executes a child through the SDK and resumes its held session successfully", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-session-resume-"));
    try {
      const runtime = await createFixtureRuntime(directory);
      runtimes.push(runtime);
      const control = getFixtureControl();
      control.setVeto(true);
      const service = getSubagentsService();
      expect(service).toBeDefined();
      if (!service) throw new Error("service did not publish on session start");

      const initial = await service.launch("explore", "ask and resume", {
        model: "offline-fixture/offline",
      });
      expect(initial.kind).toBe("accepted");
      if (initial.kind !== "accepted") return;

      await service.waitForAll();
      const waiting = service.getRecord(initial.id);
      expect(waiting).toMatchObject({
        status: "completed",
        pendingQuestion: "What should I do next?",
        result: "offline fixture waiting result",
      });

      const resumed = await service.resume(
        initial.id,
        "Continue with the answer",
        {
          claimOutcome: true,
        },
      );
      expect(resumed.kind).toBe("resumed");
      if (resumed.kind !== "resumed") return;
      expect(resumed.record).toMatchObject({
        status: "completed",
        result: "offline fixture resumed result",
      });
      expect(resumed.record.pendingQuestion).toBeUndefined();
    } finally {
      for (const candidate of runtimes.splice(0)) await candidate.dispose();
      await removeTempDir(directory);
    }
  }, 30_000);

  it("preserves an active child and its service owner when replacement is vetoed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-session-veto-active-"));
    let control: VetoFixtureControl | undefined;
    try {
      const runtime = await createFixtureRuntime(directory);
      runtimes.push(runtime);
      control = getFixtureControl();
      control.setVeto(true);
      const service = getSubagentsService();
      expect(service).toBeDefined();
      if (!service) throw new Error("service did not publish on session start");

      const initial = await service.launch("explore", "hold active child", {
        model: "offline-fixture/offline",
      });
      expect(initial.kind).toBe("accepted");
      if (initial.kind !== "accepted") return;
      await vi.waitFor(() =>
        expect(service.getRecord(initial.id)?.status).toMatch(
          /^(queued|running)$/,
        ),
      );

      const beforeVeto = service.getRecord(initial.id);
      expect(beforeVeto).toBeDefined();
      const switched = await runtime.newSession();
      expect(switched).toEqual({ cancelled: true });
      expect(getSubagentsService()).toBe(service);
      expect(service.getRecord(initial.id)).toMatchObject({
        id: initial.id,
        status: beforeVeto?.status,
      });

      control.releaseHeldResponse();
      await service.waitForAll();
      expect(service.getRecord(initial.id)).toMatchObject({
        status: "completed",
        result: "offline fixture held result",
      });
    } finally {
      control?.releaseHeldResponse();
      for (const candidate of runtimes.splice(0)) await candidate.dispose();
      await removeTempDir(directory);
    }
  }, 30_000);

  it("replaces the service owner only after a confirmed session replacement", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-session-replacement-"));
    try {
      const runtime = await createFixtureRuntime(directory);
      runtimes.push(runtime);
      const control = getFixtureControl();
      control.setVeto(false);
      const service = getSubagentsService();
      expect(service).toBeDefined();
      if (!service) throw new Error("service did not publish on session start");

      const initial = await service.launch("explore", "confirmed replacement", {
        model: "offline-fixture/offline",
      });
      expect(initial.kind).toBe("accepted");
      if (initial.kind !== "accepted") return;
      await service.waitForAll();

      const switched = await runtime.newSession();
      expect(switched).toEqual({ cancelled: false });
      const replacement = getSubagentsService();
      expect(replacement).toBeDefined();
      expect(replacement).not.toBe(service);
      expect(service.getRecord(initial.id)).toBeUndefined();

      const next = await replacement?.launch("explore", "new owner works", {
        model: "offline-fixture/offline",
      });
      expect(next?.kind).toBe("accepted");
      if (next?.kind === "accepted") replacement?.abort(next.id);
      await replacement?.waitForAll();
    } finally {
      for (const candidate of runtimes.splice(0)) await candidate.dispose();
      await removeTempDir(directory);
    }
  }, 30_000);
});
