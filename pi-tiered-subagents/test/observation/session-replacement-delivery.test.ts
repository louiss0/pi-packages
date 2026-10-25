import { describe, expect, it, vi } from "vitest";
import { NotificationManager } from "#src/observation/notification";
import { SubagentEventsObserver } from "#src/observation/subagent-events-observer";
import { createSubagentsHarness } from "#test/helpers/subagents-harness";

describe("session replacement delivery integration", () => {
  it("suppresses old delivery before stopping accepted children, while persisting both outcomes", async () => {
    const sent: unknown[] = [];
    const notifications = new NotificationManager((message) => {
      sent.push(message);
    });
    const persisted: Array<{ id: string; status: string }> = [];
    const order: string[] = [];
    const events = new SubagentEventsObserver({
      emit: vi.fn(),
      appendEntry: (_type, data) => {
        order.push(`persist:${String((data as { id: string }).id)}`);
        persisted.push(data as { id: string; status: string });
      },
      notifications,
    });
    const h = await createSubagentsHarness({ observer: events });

    try {
      const first = await h.service.launch("worker", "first child");
      const second = await h.service.launch("explore", "sibling child");
      if (first.kind !== "accepted" || second.kind !== "accepted")
        throw new Error("replacement setup should accept both children");
      const firstChild = await h.children.childBorn(0);
      const secondChild = await h.children.childBorn(1);
      await firstChild.runStarted(0);
      await secondChild.runStarted(0);

      // This is the lifecycle ordering used by session replacement: retire the
      // old carrier first, then let the manager cancel its owned children.
      h.beginSessionEnd();
      order.push("suppress-old-delivery");
      notifications.dispose();
      await h.beginSession("session-2");

      expect(order[0]).toBe("suppress-old-delivery");
      expect(persisted).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: first.id, status: "stopped" }),
          expect.objectContaining({ id: second.id, status: "stopped" }),
        ]),
      );
      expect(h.service.getRecord(first.id)?.status).toBe("stopped");
      expect(h.service.getRecord(second.id)?.status).toBe("stopped");
      expect(firstChild.disposeCount).toBe(1);
      expect(secondChild.disposeCount).toBe(1);
      expect(sent).toHaveLength(0);
      expect(h.observer.runFinished.map((run) => run.status)).toEqual([
        "stopped",
        "stopped",
      ]);
    } finally {
      await h.dispose();
    }
  });
});
