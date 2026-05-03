import { safeParse } from "valibot";

export const parseObjectErrors = <T extends Record<string, unknown>>(
  schema: Parameters<typeof safeParse>[0],
  values: T,
) => {
  const result = safeParse(schema, values);

  if (result.success) {
    return undefined;
  }

  const errors = new Map<string, string>();

  for (const issue of result.issues) {
    const key = issue.path?.[0].key;

    if (typeof key !== "string") {
      continue;
    }

    const currentError = errors.get(key);
    errors.set(key, currentError ? `${currentError}\n${issue.message}` : issue.message);
  }

  return Object.fromEntries(errors.entries()) as Record<keyof typeof values, string>;
};
