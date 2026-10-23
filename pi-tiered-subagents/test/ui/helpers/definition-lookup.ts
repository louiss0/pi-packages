import type { getDisplayName } from "#src/ui/display";

/** Only the names the UI cases exercise, not the runtime's agent registry. */
export function makeDefinitionLookup(
  names: Readonly<Record<string, string | undefined>> = {},
): Parameters<typeof getDisplayName>[1] {
  const fixtures: Readonly<Record<string, string | undefined>> = {
    worker: "Worker",
    explore: "Explore",
    ...names,
  };
  return {
    find: (id) =>
      Object.hasOwn(fixtures, id)
        ? { id, displayName: fixtures[id] ?? "" }
        : undefined,
  };
}
