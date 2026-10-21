/**
 * A scheduler that holds every thunk until the test opens the slot — a stand-in
 * for the concurrency limiter when a test needs a run to wait in the queue.
 */
export function gatedScheduler(): {
  schedule: (thunk: () => Promise<void>) => Promise<void>;
  openSlot: () => void;
} {
  const { promise: gate, resolve: openSlot } = Promise.withResolvers<void>();
  return {
    schedule: async (thunk) => {
      await gate;
      await thunk();
    },
    openSlot: () => {
      openSlot();
    },
  };
}
