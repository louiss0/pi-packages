import { expect, it, vi } from "vitest";
import { createSubagentsHarness } from "#test/helpers/subagents-harness";

it("settles a cancelled queued run without releasing another child's capacity", async () => {
  const h = await createSubagentsHarness({ concurrency: 1 });
  try {
    const first = await h.service.launch("explore", "hold A");
    expect(first.kind).toBe("accepted");
    const a = await h.children.childBorn(0);
    const runningA = await a.runStarted(0);
    const controller = new AbortController();
    const finished = vi.fn();
    const pending = h.service
      .run("explore", "cancel B", {
        signal: controller.signal,
        description: "queued B",
      })
      .then((result) => {
        finished(result);
        return result;
      });
    await vi.waitFor(() => {
      expect(
        h.service.listAgents().find((r) => r.description === "queued B")
          ?.status,
      ).toBe("queued");
    });
    controller.abort();
    await vi.waitFor(() => expect(finished).toHaveBeenCalledOnce(), {
      timeout: 200,
    });
    expect(await pending).toMatchObject({
      kind: "settled",
      record: { status: "stopped" },
    });
    const third = await h.service.launch("explore", "wait C");
    if (third.kind !== "accepted") throw new Error("C was refused");
    expect(h.service.getRecord(third.id)?.status).toBe("queued");
    expect(h.children.children).toHaveLength(1);
    expect(runningA.signal?.aborted).toBe(false);
    runningA.settle("A done");
    const c = await h.children.childBorn(1);
    expect(c.params.type).toBe("explore");
    (await c.runStarted(0)).settle("C done");
    await h.service.waitForAll();
    expect(h.children.children).toHaveLength(2);
  } finally {
    await h.dispose();
  }
});

it("aborts a queued initial launch promptly without releasing another child's capacity", async () => {
  const h = await createSubagentsHarness({ concurrency: 1 });
  try {
    const first = await h.service.launch("explore", "hold A");
    if (first.kind !== "accepted") throw new Error("A was refused");
    const a = await h.children.childBorn(0);
    const runningA = await a.runStarted(0);

    const queued = await h.service.launch("explore", "abort B", {
      description: "queued B",
    });
    if (queued.kind !== "accepted") throw new Error("B was refused");
    await vi.waitFor(() =>
      expect(h.service.getRecord(queued.id)?.status).toBe("queued"),
    );

    expect(h.service.abort(queued.id)).toBe(true);
    await vi.waitFor(() =>
      expect(h.service.getRecord(queued.id)?.status).toBe("stopped"),
    );

    const third = await h.service.launch("explore", "wait C");
    if (third.kind !== "accepted") throw new Error("C was refused");
    expect(h.service.getRecord(third.id)?.status).toBe("queued");
    expect(h.children.children).toHaveLength(1);
    expect(runningA.signal?.aborted).toBe(false);

    runningA.settle("A done");
    const c = await h.children.childBorn(1);
    (await c.runStarted(0)).settle("C done");
    await h.service.waitForAll();
  } finally {
    await h.dispose();
  }
});

it.each([
  "signal",
  "abort",
] as const)("settles a queued resume promptly when cancelled by %s without releasing another child's capacity", async (cancellation) => {
  const h = await createSubagentsHarness({ concurrency: 1 });
  try {
    const first = await h.service.launch("explore", "finish A");
    if (first.kind !== "accepted") throw new Error("A was refused");
    const a = await h.children.childBorn(0);
    (await a.runStarted(0)).settle("A done");
    await h.service.waitForAll();

    const holder = await h.service.launch("explore", "hold B");
    if (holder.kind !== "accepted") throw new Error("B was refused");
    const b = await h.children.childBorn(1);
    const runningB = await b.runStarted(0);

    const controller = new AbortController();
    const finished = vi.fn();
    const resumed = h.service
      .resume(
        first.id,
        "resume A",
        cancellation === "signal" ? { signal: controller.signal } : {},
      )
      .then((result) => {
        finished(result);
        return result;
      });
    await vi.waitFor(() => {
      expect(h.service.getRecord(first.id)?.status).toBe("queued");
    });

    if (cancellation === "signal") controller.abort();
    else expect(h.service.abort(first.id)).toBe(true);

    await vi.waitFor(() => expect(finished).toHaveBeenCalledOnce(), {
      timeout: 200,
    });
    await expect(resumed).resolves.toMatchObject({
      kind: "resumed",
      record: { status: "stopped" },
    });
    expect(runningB.signal?.aborted).toBe(false);

    const third = await h.service.launch("explore", "wait C");
    if (third.kind !== "accepted") throw new Error("C was refused");
    expect(h.service.getRecord(third.id)?.status).toBe("queued");
    expect(h.children.children).toHaveLength(2);

    runningB.settle("B done");
    const c = await h.children.childBorn(2);
    (await c.runStarted(0)).settle("C done");
    await h.service.waitForAll();
  } finally {
    await h.dispose();
  }
});
