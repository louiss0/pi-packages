import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import nuBashExtension from "./index";

// Every spawned process is stubbed so the timeout is the only real clock at play
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

type RegisteredTool = Parameters<ExtensionAPI["registerTool"]>[0];
type BashToolDetails = { killed?: boolean };

class FakeChildProcess extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly pid = 1337;
}

const timeoutCases = Array.from(
  { length: 15 },
  (_, increment) => (increment + 1) * 100,
);

describe("bash tool timeout", () => {
  let bashTool: RegisteredTool | undefined;
  let nushellChild: FakeChildProcess;

  beforeEach(() => {
    // Force the Windows branch so every case exercises the same taskkill path
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    // Never signal real processes if the Unix branch is reached
    vi.spyOn(process, "kill").mockReturnValue(true);
    const registeredTools = new Map<string, RegisteredTool>();
    const api = {
      registerTool: (tool: RegisteredTool) => {
        registeredTools.set(tool.name, tool);
      },
      registerShortcut: vi.fn(),
      on: vi.fn(),
    } as unknown as ExtensionAPI;
    nuBashExtension(api);
    bashTool = registeredTools.get("bash");

    vi.mocked(spawn).mockImplementation((command: string) => {
      const child = new FakeChildProcess();
      if (command !== "taskkill") {
        nushellChild = child;
      }
      return child as ReturnType<typeof spawn>;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(
    timeoutCases,
  )("aborts the nushell process once the %i ms timeout elapses", async (timeoutMs) => {
    expect(bashTool).toBeDefined();
    const context = { cwd: process.cwd() } as ExtensionContext;
    vi.useFakeTimers();

    const execution = bashTool!.execute(
      "timeout-check",
      { command: "nx build --skip-nx-cache", timeout: timeoutMs / 1000 },
      undefined,
      undefined,
      context,
    );

    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(timeoutMs - 1);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(spawn).toHaveBeenLastCalledWith(
      "taskkill",
      ["/pid", String(nushellChild.pid), "/t", "/f"],
      expect.objectContaining({ windowsHide: true }),
    );

    nushellChild.emit("close", null);
    const result = await execution;

    expect(result.isError).toBe(true);
    expect((result.details as BashToolDetails | undefined)?.killed).toBe(true);
  });
});
