import { describe, expect, it, vi } from "vitest";
import { NotificationManager } from "#src/observation/notification";
import { SubagentEventsObserver } from "#src/observation/subagent-events-observer";
import { createTestSubagent } from "#test/helpers/make-subagent";

type SentMessage = {
  readonly content: string;
};

function taskId(content: string): string {
  return /<task-id>([^<]*)<\/task-id>/.exec(content)?.[1] ?? "";
}

function createObserver(notifications: NotificationManager) {
  const emit = vi.fn<(channel: string, data: unknown) => void>();
  const appendEntry = vi.fn<(customType: string, data: unknown) => void>();
  return {
    observer: new SubagentEventsObserver({
      emit,
      appendEntry,
      notifications,
    }),
    emit,
    appendEntry,
  };
}

describe("notification and persistence policy", () => {
  it("withholds unclaimed outcomes during a parent run, then flushes them in completion order", () => {
    const sendMessage = vi.fn();
    const notifications = new NotificationManager(sendMessage);
    const first = createTestSubagent({ id: "first" });
    const second = createTestSubagent({ id: "second" });

    notifications.onParentAgentStart();
    notifications.sendCompletion(first);
    notifications.sendCompletion(second);

    expect(sendMessage).not.toHaveBeenCalled();

    notifications.onParentAgentSettled();

    expect(
      sendMessage.mock.calls.map(([message]) =>
        taskId((message as SentMessage).content),
      ),
    ).toEqual(["first", "second"]);
  });

  it("rechecks claims and consumption at flush time rather than delivering a duplicate outcome", () => {
    const sendMessage = vi.fn();
    const notifications = new NotificationManager(sendMessage);
    const consumed = createTestSubagent({ id: "consumed" });
    const claimed = createTestSubagent({ id: "claimed" });

    notifications.onParentAgentStart();
    notifications.sendCompletion(consumed);
    notifications.sendCompletion(claimed);
    consumed.markConsumed();
    claimed.claim();

    notifications.onParentAgentSettled();

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("persists a stopped outcome even when old-session delivery was suppressed before cancellation", () => {
    const sendMessage = vi.fn();
    const notifications = new NotificationManager(sendMessage);
    const { observer, appendEntry } = createObserver(notifications);
    const stopped = createTestSubagent({
      id: "stopped-on-replacement",
      status: "stopped",
      result: undefined,
    });

    // Session replacement silences its old delivery manager before it cancels
    // accepted work. The terminal transition must still retain history.
    notifications.dispose();
    observer.onSubagentRunFinished(stopped, "initial");

    expect(appendEntry).toHaveBeenCalledExactlyOnceWith(
      "subagents:record",
      expect.objectContaining({
        id: "stopped-on-replacement",
        status: "stopped",
      }),
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("does not deliver a terminal result from a disposed parent after its run settles", () => {
    const sendMessage = vi.fn();
    const notifications = new NotificationManager(sendMessage);
    const oldParentRecord = createTestSubagent({ id: "old-parent-child" });

    notifications.onParentAgentStart();
    notifications.sendCompletion(oldParentRecord);
    notifications.dispose();
    notifications.onParentAgentSettled();

    expect(sendMessage).not.toHaveBeenCalled();
  });
});
