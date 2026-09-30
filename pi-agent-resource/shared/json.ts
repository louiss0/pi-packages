export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJson(content: string) {
  try {
    return { success: true as const, value: JSON.parse(content) as unknown };
  } catch {
    return { success: false as const };
  }
}

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** A missing file is the normal "not configured yet" case, so callers can ignore it. */
export function isNotFoundError(error: Error) {
  return "code" in error && error.code === "ENOENT";
}
