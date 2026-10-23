/**
 * optional.ts — Building objects whose absent keys really are absent.
 *
 * With `exactOptionalPropertyTypes` on, `{ field: undefined }` and `{}` are
 * different types: the first says "a value was supplied, and it was nothing",
 * the second says "nothing was supplied". Definition merging, layered
 * configuration, and by-value snapshots all depend on that difference, so
 * these helpers build the second kind rather than spreading `undefined` into
 * it and letting the compiler say so at every call site.
 */

/**
 * `T` with every possibly-undefined property optional, and no property
 * accepting an explicit `undefined`.
 *
 * Keys whose type cannot be undefined stay required: `defined` only answers
 * for the values that might not have been decided, and forcing a producer to
 * also restate the ones that were would be noise.
 */
export type Defined<T> = {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<
    T[K],
    undefined
  >;
} & {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
};

/**
 * The entries of `fields` that have a value, shaped so they can be spread into
 * an object literal — or passed straight through as the argument — whose
 * target declares no `| undefined` optionals.
 *
 * The cast narrows the runtime filter back to the keys it kept. The loop only
 * writes entries the filter accepted, which is exactly what `Defined<T>`
 * describes; TypeScript cannot follow that through `Object.entries`, whose
 * keys are `string` rather than `keyof T`.
 *
 * The `const` type parameter keeps a literal argument literal — without it a
 * field like `{ kind: "default" }` would widen to `{ kind: string }` on the way
 * through, and stop matching the discriminated union it was written for.
 *
 * Use it wherever a value is genuinely undecided — a merged field that no layer
 * set, a record's getter for a value the run has not produced yet:
 *
 * ```typescript
 * return {
 *   id,
 *   ...defined({ model, thinking, maxTurns }),
 * };
 * ```
 */
export function defined<const T extends object>(fields: T): Defined<T> {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) kept[key] = value;
  }
  return kept as Defined<T>;
}

/**
 * `Partial<T>` with every field also accepting an explicit `undefined`.
 *
 * For override bags — a fixture factory's options, a renderer's patch object —
 * where "the caller said nothing" and "the caller said: no value" are the same
 * instruction: leave the key as you found it. The distinction
 * `exactOptionalPropertyTypes` draws is right for a producer assembling a
 * record and wrong for a patch, which never assembles one.
 *
 * The counterpart is {@link defined}: a factory whose target type admits no
 * `undefined` folds its bag through it, which keeps the default rather than
 * clearing it. A factory whose target admits one — a read view over a live
 * record — lays its bag over the defaults with {@link merge}, so a caller can
 * clear a defaulted field.
 */
export type Patch<T> = { [K in keyof T]?: T[K] | undefined };

/**
 * `defaults` with `patch` laid over it: a field the patch sets to `undefined`
 * is cleared, a field the patch says nothing about keeps the default.
 *
 * The one-line spread cannot say that. An optional property's read type
 * includes `undefined`, so `{ ...defaults, ...patch }` types every key the
 * patch *mentions* as possibly erased — even for a patch whose own type gives
 * it no way to be erased. `merge` writes the keys the patch actually carries,
 * which is what the object spread does at runtime and what the spread stops
 * being able to prove.
 *
 * ```typescript
 * return merge({ id: "agent-1", status: "completed", result: "All done." }, overrides);
 * ```
 */
export function merge<T extends object>(defaults: T, patch: Patch<T>): T {
  const merged = { ...defaults } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = value;
  }
  // `merged` holds exactly `defaults` with `patch`'s own keys written over it,
  // and `patch` is typed as a bag of `T`'s fields — the same shape the spread
  // produces, which the compiler cannot carry through the loop.
  return merged as T;
}
