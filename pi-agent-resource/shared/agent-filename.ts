export function isSafeAgentFilename(value: string): boolean {
  return (
    /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value)
  );
}
