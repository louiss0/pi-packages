import { describe, expect, it } from "vitest";
import type { CreateSubagentSessionParams } from "#src/lifecycle/create-subagent-session";
import { createControllableChildFactory } from "#test/helpers/controllable-child-session";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";
import { limitedTurns, UNLIMITED_TURNS } from "#test/helpers/turn-policy";

function params(
  overrides: Partial<CreateSubagentSessionParams> = {},
): CreateSubagentSessionParams {
  return {
    snapshot: STUB_SNAPSHOT,
    type: "worker",
    turnPolicy: UNLIMITED_TURNS,
    ...overrides,
  };
}

describe("createControllableChildFactory", () => {
  it("pauses a run's turn loop until the test settles it", async () => {
    const factory = createControllableChildFactory();
    const session = await factory.createChild(params());
    const child = factory.childAt(0);
    expect(child.session).toBe(session);

    const loop = child.session.runTurnLoop("do work", {});
    let loopSettled = false;
    void loop.then(() => {
      loopSettled = true;
    });
    await Promise.resolve();
    expect(loopSettled).toBe(false);

    child.runAt(0).settle("the answer");
    await expect(loop).resolves.toMatchObject({ responseText: "the answer" });
  });

  it("fails a run's turn loop with the test's error", async () => {
    const factory = createControllableChildFactory();
    await factory.createChild(params());
    const child = factory.childAt(0);

    const loop = child.session.runTurnLoop("do work", {});
    child.runAt(0).fail(new Error("provider exploded"));
    await expect(loop).rejects.toThrow("provider exploded");
    // The settled watcher resolves either way rather than rejecting.
    await expect(child.runAt(0).settled).resolves.toBeUndefined();
  });

  it("starts each run's budget counter fresh under the child's captured policy", async () => {
    const factory = createControllableChildFactory();
    await factory.createChild(params({ turnPolicy: limitedTurns(4, 2) }));
    const child = factory.childAt(0);

    const budgets: unknown[] = [];
    child.session.runTurnLoop("first", {
      onTurnBudget: (b) => budgets.push(b),
    });
    const first = child.runAt(0);
    first.advanceTurn();
    first.advanceTurn();
    first.settle();
    expect(first.budgets).toEqual([
      { maxTurns: 4, used: 0, phase: "within" },
      { maxTurns: 4, used: 1, phase: "within" },
      { maxTurns: 4, used: 2, phase: "within" },
    ]);

    child.session.runTurnLoop("second", {});
    // The resume's counter starts over: the first report has used 0 again.
    expect(child.runAt(1).budgets[0]).toEqual({
      maxTurns: 4,
      used: 0,
      phase: "within",
    });
    child.runAt(1).settle();
  });

  it("marks an exhausted settlement so the record reads the turn-limit outcome", async () => {
    const factory = createControllableChildFactory();
    await factory.createChild(params({ turnPolicy: limitedTurns(2) }));
    const child = factory.childAt(0);

    const loop = child.session.runTurnLoop("do work", {});
    child.runAt(0).settleExhausted("partial");
    await expect(loop).resolves.toMatchObject({
      responseText: "partial",
      turnBudget: { maxTurns: 2, used: 0, phase: "exhausted" },
    });
  });

  it("settles a running loop when its abort lever fires, by default", async () => {
    const factory = createControllableChildFactory();
    await factory.createChild(params());
    const child = factory.childAt(0);

    const controller = new AbortController();
    const loop = child.session.runTurnLoop("do work", {
      signal: controller.signal,
    });
    child.runAt(0).cancel();
    await expect(loop).resolves.toMatchObject({ responseText: "" });
  });

  it("can ignore the abort lever, simulating a child that never notices", async () => {
    const factory = createControllableChildFactory({ settleOnAbort: false });
    await factory.createChild(params());
    const child = factory.childAt(0);

    const controller = new AbortController();
    const loop = child.session.runTurnLoop("do work", {
      signal: controller.signal,
    });
    controller.abort();
    let loopSettled = false;
    void loop.then(() => {
      loopSettled = true;
    });
    await Promise.resolve();
    expect(loopSettled).toBe(false);

    // The test still controls the ending: the hung loop settles when told.
    child.runAt(0).settle("eventually");
    await expect(loop).resolves.toMatchObject({ responseText: "eventually" });
  });

  it("takes no turn on a lever that already fired, like the real prompt path", async () => {
    const factory = createControllableChildFactory();
    await factory.createChild(params());
    const child = factory.childAt(0);

    const controller = new AbortController();
    controller.abort();
    await expect(
      child.session.runTurnLoop("do work", { signal: controller.signal }),
    ).resolves.toMatchObject({ responseText: "" });
  });

  it("releases the abort listener when the loop settles first", async () => {
    const factory = createControllableChildFactory();
    await factory.createChild(params());
    const child = factory.childAt(0);

    const controller = new AbortController();
    child.session.runTurnLoop("do work", { signal: controller.signal });
    expect(controller.signal.aborted).toBe(false);
    child.runAt(0).settle();
    // Firing the lever afterwards must not throw or re-settle the run.
    controller.abort();
    await child.runAt(0).settled;
  });

  it("records steers and drives event subscribers", async () => {
    const factory = createControllableChildFactory();
    await factory.createChild(params());
    const child = factory.childAt(0);

    await child.session.steer("hurry up");
    expect(child.steered).toEqual(["hurry up"]);

    const seen: unknown[] = [];
    const unsubscribe = child.session.subscribe((event) => seen.push(event));
    child.emit({ type: "turn_start" });
    expect(seen).toEqual([{ type: "turn_start" }]);
    expect(child.listenerCount()).toBe(1);
    unsubscribe();
    expect(child.listenerCount()).toBe(0);
  });

  it("records dispose requests and resolves them immediately", async () => {
    const factory = createControllableChildFactory();
    await factory.createChild(params());
    const child = factory.childAt(0);

    expect(child.disposeCount).toBe(0);
    const firstDispose = child.session.dispose();
    const secondDispose = child.session.dispose();
    await expect(firstDispose).resolves.toBeUndefined();
    await expect(secondDispose).resolves.toBeUndefined();
    expect(child.disposeCount).toBe(1);
    await expect(child.disposeRequested).resolves.toBeUndefined();
  });

  it("holds creations while paused and releases them in order", async () => {
    const factory = createControllableChildFactory();
    factory.pauseCreation();
    const first = factory.createChild(params({ type: "one" }));
    const second = factory.createChild(params({ type: "two" }));
    await Promise.resolve();
    expect(factory.children).toHaveLength(0);

    factory.resumeCreation();
    await first;
    await second;
    expect(factory.childAt(0).params.type).toBe("one");
    expect(factory.childAt(1).params.type).toBe("two");
  });

  it("rejects a creation the test marked as failed", async () => {
    const factory = createControllableChildFactory();
    factory.failNextCreation(new Error("SDK construction failed"));
    await expect(factory.createChild(params())).rejects.toThrow(
      "SDK construction failed",
    );
    // Only the marked creation fails; the next one succeeds.
    await factory.createChild(params());
    expect(factory.children).toHaveLength(1);
  });

  it("announces creations and run starts to waiters, in either order", async () => {
    const factory = createControllableChildFactory();
    // Registered before the event.
    const childPromise = factory.childBorn(0);
    await factory.createChild(params());
    const child = await childPromise;
    // Satisfied immediately for an event that already happened.
    await expect(factory.childBorn(0)).resolves.toBe(child);

    const runPromise = child.runStarted(0);
    child.session.runTurnLoop("do work", {});
    const run = await runPromise;
    expect(run.prompt).toBe("do work");
    // A waiter for a later run is not consumed by an earlier run's arrival.
    const secondRunPromise = child.runStarted(1);
    child.session.runTurnLoop("more work", {});
    await expect(secondRunPromise).resolves.toMatchObject({
      prompt: "more work",
    });
    run.settle();
    await run.settled;
    child.runAt(1).settle();
  });
});
