import { spawn } from "node:child_process";

import type { AutocompleteItem, AutocompleteSuggestions } from "@mariozechner/pi-tui";

export interface CommandMetadata {
  name?: string;
  description?: string;
  search_terms?: string;
  signatures?: Array<Record<string, unknown>>;
  signature?: Record<string, unknown>;
  type?: string;
}

export interface CommandCompletionItem extends AutocompleteItem {
  requiresClosure: boolean;
}

function isClosureFirstCommand(command: CommandMetadata) {
  const signatures = Array.isArray(command.signatures) ? command.signatures : [];
  const signatureTexts = [command.signature, ...signatures]
    .filter((signature) => signature !== undefined && signature !== null)
    .map((signature) => JSON.stringify(signature).toLowerCase())
    .join(" ");

  return signatureTexts.includes("closure") || signatureTexts.includes("block");
}

function buildCommandCompletionItem(command: CommandMetadata): CommandCompletionItem {
  const label = command.name ?? "";
  return {
    value: label,
    label,
    description: command.description,
    requiresClosure: isClosureFirstCommand(command),
  };
}

export async function getCommandSuggestions(
  prefix: string,
  signal?: AbortSignal,
): Promise<
  (Pick<AutocompleteSuggestions, "prefix"> & { items: Array<CommandCompletionItem> }) | null
> {
  const safePrefix = prefix.replace(/'/g, "''");
  const command = prefix
    ? `scope commands
    | select name description signatures type
    | where (($it.name | default "")
    | str starts-with '${safePrefix}') or (($it.description | default "")
    | str starts-with '${safePrefix}') | to json`
    : `scope commands | select name description signatures type | to json`;

  const result = await new Promise<{ output: string; exitCode: number }>((resolve, reject) => {
    const child = spawn("nu", ["-c", command], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const stdout: Buffer[] = [];

    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.on("error", reject);
    signal?.addEventListener("abort", () => child.kill(), { once: true });
    child.on("close", (exitCode) => {
      resolve({ output: Buffer.concat(stdout).toString("utf-8"), exitCode: exitCode ?? 1 });
    });
  });

  if (result.exitCode !== 0) {
    return null;
  }

  const commands = JSON.parse(result.output) as CommandMetadata[];
  return commands.length > 0
    ? { prefix, items: commands.map(buildCommandCompletionItem) }
    : null;
}
