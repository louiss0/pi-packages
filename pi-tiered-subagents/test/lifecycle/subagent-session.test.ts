/**
 * The nth recorded entry of a mock — a call tuple, a result, or an order stamp.
 *
 * Every use is preceded by an assertion that the call happened, so "no call"
 * is a failed expectation rather than something the type system must allow for.
 */
function callAt<T>(values: readonly T[], index = 0): T {
  const value = values[index];
  if (value === undefined)
    throw new Error(`expected entry #${index} to be recorded`);
  return value;
}

import { defined } from "#src/optional";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubagentSession } from "#src/lifecycle/subagent-session";
import {
  createChildLifecycleMock,
  createFactorySession,
} from "#test/helpers/subagent-session-io";
import { childCompletedEvent } from "#test/helpers/turn-loop-result";

// ── Session mock factory ───────────────────────────────────────────────────────

function createSession(finalText: string) {
  const base = createFactorySession();
  const session = {
    ...base,
    prompt: vi.fn(async (): Promise<void> => {
      base.messages.push(assistantMessage(finalText));
    }),
    getSessionStats: vi.fn(() => ({
      tokens: { input: 100, output: 50, cacheWrite: 10 },
      contextUsage: { percent: 42 },
    })),
  };
  return { session };
}

type TestSession = ReturnType<typeof createSession>["session"];

function assistantMessage(text: string, stopReason?: string) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    ...(stopReason === undefined ? {} : { stopReason }),
  };
}

function providerErrorMessage(errorMessage?: string) {
  return {
    ...assistantMessage("", "error"),
    ...(errorMessage === undefined ? {} : { errorMessage }),
  };
}

const EMPTY_USAGE = { input: 0, output: 0, cacheWrite: 0 };

function programMessages(
  session: TestSession,
  messages: Array<Record<string, unknown>>,
) {
  session.prompt = vi.fn(async () => {
    for (const message of messages) {
      session.messages.push(message);
      session.emit({
        type: "message_end",
        message: { usage: EMPTY_USAGE, ...message },
      });
    }
  });
}

function programStrippedFailure(session: TestSession, errorMessage: string) {
  session.prompt = vi.fn(async () => {
    session.emit({
      type: "message_end",
      message: { usage: EMPTY_USAGE, ...providerErrorMessage(errorMessage) },
    });
  });
}

function makeSubagentSession(
  session: TestSession,
  metaOverrides?: Partial<{
    outputFile: string | undefined;
    sessionId: string;
    sessionDir: string;
    agentName: string;
    lifecycle: ReturnType<typeof createChildLifecycleMock>;
  }>,
) {
  const lifecycle = metaOverrides?.lifecycle ?? createChildLifecycleMock();
  const hasOutputFile = metaOverrides != null && "outputFile" in metaOverrides;
  const sub = new SubagentSession(
    session as unknown as AgentSession,
    defined({
      sessionId: metaOverrides?.sessionId ?? "child-session-default",
      sessionDir: metaOverrides?.sessionDir ?? "/sessions/dir",
      agentName: metaOverrides?.agentName ?? "Explore",
      lifecycle,
      outputFile: hasOutputFile
        ? metaOverrides.outputFile
        : "/sessions/child.jsonl",
    }),
  );
  return { sub, lifecycle };
}

let lifecycle: ReturnType<typeof createChildLifecycleMock>;

beforeEach(() => {
  lifecycle = createChildLifecycleMock();
});

describe("SubagentSession — accessors", () => {
  it("exposes the wrapped session and outputFile", () => {
    const { session } = createSession("X");
    const { sub } = makeSubagentSession(session, { outputFile: "/out.jsonl" });
    expect(sub.session).toBe(session);
    expect(sub.outputFile).toBe("/out.jsonl");
  });

  it("returns undefined outputFile when none was persisted", () => {
    const { session } = createSession("X");
    const { sub } = makeSubagentSession(session, { outputFile: undefined });
    expect(sub.outputFile).toBeUndefined();
  });

  describe("model and thinking level", () => {
    it("reports the wrapped session's current model", () => {
      const { session } = createSession("X");
      const { sub } = makeSubagentSession(session);
      const sonnet = { provider: "anthropic", id: "claude-sonnet-5" };
      session.model = sonnet;
      expect(sub.model).toBe(sonnet);
    });

    it("follows a model the wrapped session switches to", () => {
      const { session } = createSession("X");
      const { sub } = makeSubagentSession(session);
      session.model = { provider: "anthropic", id: "claude-sonnet-5" };
      const fallback = { provider: "openai", id: "gpt-6" };
      session.model = fallback;
      expect(sub.model).toBe(fallback);
    });

    it("reports the wrapped session's current thinking level", () => {
      const { session } = createSession("X");
      const { sub } = makeSubagentSession(session);
      session.thinkingLevel = "high";
      expect(sub.thinkingLevel).toBe("high");
    });
  });
});

describe("SubagentSession — runTurnLoop response capture", () => {
  it("returns the final assistant text even when no text_delta events streamed", async () => {
    const { session } = createSession("LOCKED");
    const { sub } = makeSubagentSession(session);
    const result = await sub.runTurnLoop("Say LOCKED", {});
    expect(result).toEqual({ responseText: "LOCKED" });
  });

  it("captures streamed text_delta events as the response", async () => {
    const { session } = createSession("FALLBACK");
    session.prompt = vi.fn(async () => {
      session.emit({ type: "message_start" });
      session.emit({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "hello " },
      });
      session.emit({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "world" },
      });
    });
    const { sub } = makeSubagentSession(session);
    const result = await sub.runTurnLoop("go", {});
    expect(result).toEqual({ responseText: "hello world" });
  });

  it("sends the prompt directly without any parent-context string prefix", async () => {
    const { session } = createSession("DONE");
    const { sub } = makeSubagentSession(session);
    await sub.runTurnLoop("the task", {});
    expect(session.prompt).toHaveBeenCalledWith("the task");
  });
});

describe("SubagentSession — inherited fork boundary", () => {
  it("excludes pre-existing inherited parent messages from messages, agentMessages, and getConversation", () => {
    const { session } = createSession("X");
    session.messages.push(
      { role: "user", content: "parent question" },
      assistantMessage("parent answer"),
    );

    const { sub } = makeSubagentSession(session);
    session.messages.push(
      { role: "user", content: "child task" },
      assistantMessage("child answer"),
    );

    expect(sub.messages).toEqual([
      { role: "user", content: "child task" },
      assistantMessage("child answer"),
    ]);
    expect(sub.agentMessages).toEqual([
      { role: "user", content: "child task" },
      assistantMessage("child answer"),
    ]);
    const conv = sub.getConversation();
    expect(conv).toContain("[User]: child task");
    expect(conv).toContain("child answer");
    expect(conv).not.toContain("parent question");
    expect(conv).not.toContain("parent answer");
  });

  it("does not fall back to an inherited parent assistant message when the child produced no text", async () => {
    const { session } = createSession("unused");
    session.messages.push(assistantMessage("parent answer before fork"));
    session.prompt = vi.fn(async () => {});

    const { sub } = makeSubagentSession(session);
    const result = await sub.runTurnLoop("go", {});

    expect(result.responseText).toBe("");
  });

  it("ignores an inherited parent assistant error that predates the child session", async () => {
    const { session } = createSession("CHILD OK");
    session.messages.push(providerErrorMessage("parent error before fork"));

    const { sub } = makeSubagentSession(session);
    await expect(sub.runTurnLoop("go", {})).resolves.toEqual({
      responseText: "CHILD OK",
    });
  });
});

describe("SubagentSession — runTurnLoop parent abort signal", () => {
  it("aborts the session when the parent signal fires mid-prompt", async () => {
    const controller = new AbortController();
    const { session } = createSession("X");
    session.prompt = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          controller.signal.addEventListener("abort", () => resolve(), {
            once: true,
          });
        }),
    );
    const { sub } = makeSubagentSession(session);
    const promise = sub.runTurnLoop("go", { signal: controller.signal });
    controller.abort();
    await promise;
    expect(session.abort).toHaveBeenCalled();
  });

  it("does not abort the session when the parent signal never fires", async () => {
    const controller = new AbortController();
    const { session } = createSession("X");
    const { sub } = makeSubagentSession(session);
    await sub.runTurnLoop("go", { signal: controller.signal });
    expect(session.abort).not.toHaveBeenCalled();
  });
});

describe("SubagentSession — runTurnLoop lifecycle events", () => {
  it("emits completed with the run outcome on the success path", async () => {
    const { session } = createSession("OK");
    const { sub } = makeSubagentSession(session, {
      sessionDir: "/d",
      agentName: "Explore",
      lifecycle,
    });
    await sub.runTurnLoop("go", {});
    expect(lifecycle.completed).toHaveBeenCalledOnce();
    expect(lifecycle.completed).toHaveBeenCalledWith(
      childCompletedEvent({
        sessionDir: "/d",
        agentName: "Explore",
      }),
    );
  });

  it("releases its turn-outcome subscription on dispose", async () => {
    const { session } = createSession("X");
    const { sub } = makeSubagentSession(session);
    expect(session.listenerCount()).toBe(1);
    await sub.dispose();
    expect(session.listenerCount()).toBe(0);
  });

  it("does not emit disposed from runTurnLoop (disposal is separate)", async () => {
    const { session } = createSession("OK");
    const { sub } = makeSubagentSession(session, { lifecycle });
    await sub.runTurnLoop("go", {});
    expect(lifecycle.disposed).not.toHaveBeenCalled();
  });

  it("skips completed when prompt throws and does not emit disposed", async () => {
    const { session } = createSession("OK");
    session.prompt = vi.fn().mockRejectedValue(new Error("prompt failed"));
    const { sub } = makeSubagentSession(session, { lifecycle });
    await expect(sub.runTurnLoop("go", {})).rejects.toThrow("prompt failed");
    expect(lifecycle.completed).not.toHaveBeenCalled();
    expect(lifecycle.disposed).not.toHaveBeenCalled();
  });
});

describe("SubagentSession — runTurnLoop provider failures", () => {
  it("rejects with the provider's error message when the last turn errored", async () => {
    const { session } = createSession("unused");
    programMessages(session, [providerErrorMessage("429 rate limit exceeded")]);
    const { sub } = makeSubagentSession(session);
    await expect(sub.runTurnLoop("go", {})).rejects.toThrow(
      "429 rate limit exceeded",
    );
  });

  it("rejects with a fallback when the errored turn carries no message", async () => {
    const { session } = createSession("unused");
    programMessages(session, [providerErrorMessage()]);
    const { sub } = makeSubagentSession(session);
    await expect(sub.runTurnLoop("go", {})).rejects.toThrow(
      "provider reported an error with no message",
    );
  });

  it("does not emit completed for a run whose provider errored", async () => {
    const { session } = createSession("unused");
    programMessages(session, [providerErrorMessage("boom")]);
    const { sub } = makeSubagentSession(session, { lifecycle });
    await expect(sub.runTurnLoop("go", {})).rejects.toThrow("boom");
    expect(lifecycle.completed).not.toHaveBeenCalled();
  });

  it("resolves normally when the last turn was aborted rather than errored", async () => {
    const { session } = createSession("unused");
    programMessages(session, [assistantMessage("partial", "aborted")]);
    const { sub } = makeSubagentSession(session, { lifecycle });
    const result = await sub.runTurnLoop("go", {});
    expect(result.responseText).toBe("partial");
    expect(lifecycle.completed).toHaveBeenCalledOnce();
  });

  it("resolves normally when the last assistant message carries no stopReason", async () => {
    const { session } = createSession("ALL DONE");
    const { sub } = makeSubagentSession(session, { lifecycle });
    const result = await sub.runTurnLoop("go", {});
    expect(result.responseText).toBe("ALL DONE");
    expect(lifecycle.completed).toHaveBeenCalledOnce();
  });

  it("resolves normally when an errored turn was followed by a clean one", async () => {
    const { session } = createSession("unused");
    programMessages(session, [
      providerErrorMessage("transient stream drop"),
      assistantMessage("recovered", "stop"),
    ]);
    const { sub } = makeSubagentSession(session, { lifecycle });
    const result = await sub.runTurnLoop("go", {});
    expect(result.responseText).toBe("recovered");
    expect(lifecycle.completed).toHaveBeenCalledOnce();
  });

  it("rejects when overflow recovery stripped the errored turn before the run settled", async () => {
    const { session } = createSession("unused");
    const { sub } = makeSubagentSession(session, { lifecycle });
    session.messages.push(
      assistantMessage("work from an earlier turn", "stop"),
    );
    programStrippedFailure(
      session,
      "prompt is too long: 210000 tokens > 200000 maximum",
    );
    await expect(sub.runTurnLoop("go", {})).rejects.toThrow(
      "prompt is too long",
    );
    expect(lifecycle.completed).not.toHaveBeenCalled();
  });

  it("resolves when overflow recovery stripped the errored turn and the retry succeeded", async () => {
    const { session } = createSession("unused");
    const recovered = assistantMessage("recovered", "stop");
    session.prompt = vi.fn(async () => {
      session.emit({
        type: "message_end",
        message: {
          usage: EMPTY_USAGE,
          ...providerErrorMessage("context overflow"),
        },
      });
      session.messages.push(recovered);
      session.emit({
        type: "message_end",
        message: { usage: EMPTY_USAGE, ...recovered },
      });
    });
    const { sub } = makeSubagentSession(session, { lifecycle });
    const result = await sub.runTurnLoop("go", {});
    expect(result.responseText).toBe("recovered");
    expect(lifecycle.completed).toHaveBeenCalledOnce();
  });
});

describe("SubagentSession — a later run", () => {
  it("re-prompts the session and returns the final assistant text", async () => {
    const { session } = createSession("RESUMED");
    const { sub } = makeSubagentSession(session);
    await sub.runTurnLoop("go", {});
    const result = await sub.runTurnLoop("Continue", {});
    expect(session.prompt).toHaveBeenLastCalledWith("Continue");
    expect(result).toEqual({
      responseText: "RESUMED",
    });
  });

  it("stays a later run when the first run threw", async () => {
    const { session } = createSession("RESUMED");
    const { sub } = makeSubagentSession(session, {
      lifecycle,
    });
    session.prompt.mockRejectedValueOnce(new Error("prompt failed"));
    await expect(sub.runTurnLoop("go", {})).rejects.toThrow("prompt failed");

    await sub.runTurnLoop("Continue", {});

    expect(session.prompt).toHaveBeenLastCalledWith("Continue");
    expect(lifecycle.completed).not.toHaveBeenCalled();
  });

  it("does not emit completed or disposed", async () => {
    const { session } = createSession("RESUMED");
    const { sub } = makeSubagentSession(session, { lifecycle });
    await sub.runTurnLoop("go", {});
    await sub.runTurnLoop("Continue", {});
    expect(lifecycle.completed).toHaveBeenCalledOnce();
    expect(lifecycle.disposed).not.toHaveBeenCalled();
  });

  it("rejects with the provider's error message when the resumed turn errored", async () => {
    const { session } = createSession("unused");
    const { sub } = makeSubagentSession(session);
    await sub.runTurnLoop("go", {});
    programMessages(session, [providerErrorMessage("401 invalid api key")]);
    await expect(sub.runTurnLoop("Continue", {})).rejects.toThrow(
      "401 invalid api key",
    );
  });

  it("does not report an earlier turn's text as the resumed answer", async () => {
    const { session } = createSession("unused");
    const { sub } = makeSubagentSession(session);
    session.messages.push(
      assistantMessage("work from the turn before the failure", "stop"),
    );
    await sub.runTurnLoop("go", {});
    programMessages(session, [providerErrorMessage("stream disconnected")]);
    await expect(sub.runTurnLoop("Continue", {})).rejects.toThrow(
      "stream disconnected",
    );
  });

  it("rejects when overflow recovery stripped the resumed turn's error", async () => {
    const { session } = createSession("unused");
    const { sub } = makeSubagentSession(session);
    session.messages.push(
      assistantMessage("work from the turn before the failure", "stop"),
    );
    await sub.runTurnLoop("go", {});
    programStrippedFailure(session, "503 upstream unavailable");
    await expect(sub.runTurnLoop("Continue", {})).rejects.toThrow(
      "503 upstream unavailable",
    );
  });

  it("rejects when the resume ran no turn and the child session's last turn had errored", async () => {
    const { session } = createSession("unused");
    const { sub } = makeSubagentSession(session);
    programMessages(session, [providerErrorMessage("429 rate limit exceeded")]);
    await expect(sub.runTurnLoop("go", {})).rejects.toThrow(
      "429 rate limit exceeded",
    );

    session.prompt = vi.fn(async () => {});
    await expect(sub.runTurnLoop("/skill:audit go", {})).rejects.toThrow(
      "429 rate limit exceeded",
    );
  });

  it("rejects when a stripped earlier failure is followed by a resume that runs no turn", async () => {
    const { session } = createSession("unused");
    const { sub } = makeSubagentSession(session);
    session.messages.push(
      assistantMessage("work from an earlier turn", "stop"),
    );
    programStrippedFailure(
      session,
      "prompt is too long: 210000 tokens > 200000 maximum",
    );
    await expect(sub.runTurnLoop("go", {})).rejects.toThrow(
      "prompt is too long",
    );

    session.prompt = vi.fn(async () => {});
    await expect(sub.runTurnLoop("/skill:audit go", {})).rejects.toThrow(
      "prompt is too long",
    );
  });

  it("resolves when the resume's own turn succeeded after an earlier failure", async () => {
    const { session } = createSession("unused");
    const { sub } = makeSubagentSession(session);
    session.messages.push(providerErrorMessage("429 rate limit exceeded"));
    programMessages(session, [assistantMessage("the second answer", "stop")]);
    await expect(sub.runTurnLoop("Continue", {})).resolves.toEqual({
      responseText: "the second answer",
    });
  });

  it("resolves normally when the resumed turn did not error", async () => {
    const { session } = createSession("RESUMED");
    const { sub } = makeSubagentSession(session);
    await sub.runTurnLoop("go", {});
    await expect(sub.runTurnLoop("Continue", {})).resolves.toEqual({
      responseText: "RESUMED",
    });
  });
});

describe("SubagentSession — a turn loop whose signal already fired", () => {
  function firedSignal(): AbortSignal {
    const controller = new AbortController();
    controller.abort();
    return controller.signal;
  }

  describe("the first run", () => {
    it("takes no turn and returns no text", async () => {
      const { session } = createSession("full answer");
      const { sub } = makeSubagentSession(session);
      const result = await sub.runTurnLoop("go", { signal: firedSignal() });
      expect(session.prompt).not.toHaveBeenCalled();
      expect(result).toEqual({
        responseText: "",
      });
    });

    it("still emits completed, as a run aborted mid-prompt does", async () => {
      const { session } = createSession("full answer");
      const { sub } = makeSubagentSession(session, {
        sessionDir: "/d",
        agentName: "Explore",
        lifecycle,
      });
      await sub.runTurnLoop("go", { signal: firedSignal() });
      expect(lifecycle.completed).toHaveBeenCalledExactlyOnceWith(
        childCompletedEvent({
          sessionDir: "/d",
          agentName: "Explore",
        }),
      );
    });
  });

  describe("a later run", () => {
    it("takes no turn and does not report the previous run's answer", async () => {
      const { session } = createSession("full answer");
      const { sub } = makeSubagentSession(session);
      await sub.runTurnLoop("go", {});
      const result = await sub.runTurnLoop("Continue", {
        signal: firedSignal(),
      });
      expect(session.prompt).toHaveBeenCalledOnce();
      expect(result).toEqual({
        responseText: "",
      });
    });

    it("resolves even when the previous run's last turn failed", async () => {
      const { session } = createSession("full answer");
      const { sub } = makeSubagentSession(session);
      session.messages.push(providerErrorMessage("401 invalid api key"));
      await expect(
        sub.runTurnLoop("Continue", { signal: firedSignal() }),
      ).resolves.toEqual({
        responseText: "",
      });
    });
  });
});

describe("SubagentSession — steer", () => {
  it("delegates the message to the live session", async () => {
    const { session } = createSession("X");
    const { sub } = makeSubagentSession(session);
    await sub.steer("hurry up");
    expect(session.steer).toHaveBeenCalledWith("hurry up");
  });
});

describe("SubagentSession — delegate methods", () => {
  it("getConversation returns formatted text from session messages", () => {
    const { session } = createSession("X");
    const { sub } = makeSubagentSession(session);
    session.messages.push({ role: "user", content: "Hello" });
    session.messages.push(assistantMessage("World"));
    const conv = sub.getConversation();
    expect(conv).toContain("[User]: Hello");
    expect(conv).toContain("[Assistant");
    expect(conv).toContain("World");
  });

  it("getContextPercent returns the session context percent", () => {
    const { session } = createSession("X");
    const { sub } = makeSubagentSession(session);
    expect(sub.getContextPercent()).toBe(42);
  });

  it("getContextPercent returns null when getSessionStats is unavailable", () => {
    const { session } = createSession("X");
    session.getSessionStats = vi.fn(() => {
      throw new Error("no stats");
    });
    const { sub } = makeSubagentSession(session);
    expect(sub.getContextPercent()).toBeNull();
  });

  it("subscribe delegates to the underlying session", () => {
    const { session } = createSession("X");
    const { sub } = makeSubagentSession(session);
    const fn = vi.fn();
    const unsub = sub.subscribe(fn);
    expect(session.subscribe).toHaveBeenCalledWith(fn);
    expect(typeof unsub).toBe("function");
  });

  it("getSessionStats delegates to the underlying session", () => {
    const { session } = createSession("X");
    const { sub } = makeSubagentSession(session);
    const stats = sub.getSessionStats();
    expect(session.getSessionStats).toHaveBeenCalled();
    expect(stats.tokens.input).toBe(100);
  });

  it("messages returns the child's session messages", () => {
    const { session } = createSession("X");
    const { sub } = makeSubagentSession(session);
    session.messages.push({ role: "user", content: "hi" });
    expect(sub.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("agentMessages returns the child's session messages typed", () => {
    const { session } = createSession("X");
    const { sub } = makeSubagentSession(session);
    session.messages.push({ role: "user", content: "hi" });
    expect(sub.agentMessages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("getToolDefinition delegates to the underlying session", () => {
    const { session } = createSession("X");
    const def = { name: "read" };
    session.getToolDefinition = vi.fn(() => def);
    const { sub } = makeSubagentSession(session);
    expect(sub.getToolDefinition("read")).toBe(def);
    expect(session.getToolDefinition).toHaveBeenCalledWith("read");
  });
});

describe("SubagentSession — dispose", () => {
  it("disposes the session and emits disposed with the child session id", async () => {
    const { session } = createSession("X");
    const { sub } = makeSubagentSession(session, {
      sessionId: "child-session-abc",
      lifecycle,
    });
    await sub.dispose();
    expect(session.dispose).toHaveBeenCalledOnce();
    expect(lifecycle.disposed).toHaveBeenCalledOnce();
    expect(lifecycle.disposed).toHaveBeenCalledWith({
      sessionId: "child-session-abc",
    });
  });

  it("emits session_shutdown to the child's extensions before disposing the session", async () => {
    const { session } = createSession("X");
    const { sub } = makeSubagentSession(session);
    await sub.dispose();
    expect(session.extensionRunner.emit).toHaveBeenCalledWith({
      type: "session_shutdown",
      reason: "quit",
    });
    const shutdownAt = callAt(
      session.extensionRunner.emit.mock.invocationCallOrder,
    );
    const disposeAt = callAt(session.dispose.mock.invocationCallOrder);
    expect(shutdownAt).toBeLessThan(disposeAt);
  });

  it("unregisters the child only after its shutdown handlers have run", async () => {
    const { session } = createSession("X");
    const { sub } = makeSubagentSession(session, { lifecycle });
    session.extensionRunner.emit = vi.fn(
      (_event: unknown): Promise<unknown> => {
        expect(lifecycle.disposed).not.toHaveBeenCalled();
        return Promise.resolve(undefined);
      },
    );
    await sub.dispose();
    expect(lifecycle.disposed).toHaveBeenCalledOnce();
  });

  it("disposes a child whose extensions registered no shutdown handler", async () => {
    const { session } = createSession("X");
    session.hasExtensionHandlers = vi.fn(
      (_eventType: string): boolean => false,
    );
    const { sub } = makeSubagentSession(session, { lifecycle });
    await sub.dispose();
    expect(session.extensionRunner.emit).not.toHaveBeenCalled();
    expect(session.dispose).toHaveBeenCalledOnce();
    expect(lifecycle.disposed).toHaveBeenCalledOnce();
  });

  it("is idempotent: a second dispose neither re-emits nor re-disposes", async () => {
    const { session } = createSession("X");
    const { sub } = makeSubagentSession(session, { lifecycle });
    await sub.dispose();
    await sub.dispose();
    expect(session.extensionRunner.emit).toHaveBeenCalledOnce();
    expect(session.dispose).toHaveBeenCalledOnce();
    expect(lifecycle.disposed).toHaveBeenCalledOnce();
  });

  it("guards re-entry before its first await, so concurrent disposes emit once", async () => {
    const { session } = createSession("X");
    const { sub } = makeSubagentSession(session, { lifecycle });
    await Promise.all([sub.dispose(), sub.dispose()]);
    expect(session.extensionRunner.emit).toHaveBeenCalledOnce();
    expect(session.dispose).toHaveBeenCalledOnce();
  });
});
