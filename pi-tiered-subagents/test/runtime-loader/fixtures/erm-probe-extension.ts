/**
 * Story 109 probe fixture: a Pi extension whose factory uses explicit resource
 * management (`using` / `await using`, `Symbol.dispose` / `Symbol.asyncDispose`)
 * in nested and throwing scopes. Loaded through Pi's real extension loader
 * (jiti) by test/runtime-loader/explicit-resource-management.test.ts; the
 * observed event order is stashed on globalThis for the test to assert.
 */

export interface ErmProbeRecord {
  syncEvents: string[];
  asyncEvents: string[];
}

export const ERM_PROBE_KEY = "__piTieredSubagentsErmProbe";

export function readErmProbeRecord(): ErmProbeRecord | undefined {
  return (globalThis as Record<string, unknown>)[ERM_PROBE_KEY] as
    | ErmProbeRecord
    | undefined;
}

function named(name: string, events: string[]): Disposable {
  return {
    [Symbol.dispose]() {
      events.push(`dispose:${name}`);
    },
  };
}

function namedAsync(name: string, events: string[]): AsyncDisposable {
  return {
    async [Symbol.asyncDispose]() {
      events.push(`dispose:${name}`);
    },
  };
}

export default async function ermProbeExtension(): Promise<void> {
  const syncEvents: string[] = [];
  {
    using _outer = named("outer", syncEvents);
    syncEvents.push("body:outer");
    {
      using _inner = named("inner", syncEvents);
      syncEvents.push("body:inner");
    }
    syncEvents.push("after:inner");
    try {
      using _thrown = named("thrown", syncEvents);
      throw new Error("boom");
    } catch {
      syncEvents.push("caught");
    }
  }
  syncEvents.push("after:outer");

  const asyncEvents: string[] = [];
  {
    await using _first = namedAsync("first", asyncEvents);
    asyncEvents.push("body:first");
    {
      await using _second = namedAsync("second", asyncEvents);
      asyncEvents.push("body:second");
    }
    asyncEvents.push("after:second");
  }
  asyncEvents.push("after:first");

  (globalThis as Record<string, unknown>)[ERM_PROBE_KEY] = {
    syncEvents,
    asyncEvents,
  } satisfies ErmProbeRecord;
}
