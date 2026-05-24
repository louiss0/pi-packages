import { spawn } from "node:child_process";
import type { InferOutput } from "valibot";
import {
  array,
  boolean,
  nullable,
  number,
  object,
  optional,
  record,
  safeParse,
  string,
  union,
} from "valibot";

import type {
  AutocompleteItem,
  AutocompleteSuggestions,
} from "@earendil-works/pi-tui";

const signatureDefaultSchema = union([string(), number(), boolean()]);
const signatureParameterSchema = object({
  parameter_name: nullable(string()),
  parameter_type: string(),
  syntax_shape: nullable(string()),
  is_optional: boolean(),
  short_flag: nullable(string()),
  description: nullable(string()),
  completion: nullable(array(string())),
  parameter_default: nullable(signatureDefaultSchema),
});
const commandSignaturesSchema = union([
  array(signatureParameterSchema),
  record(string(), array(signatureParameterSchema)),
]);

const CommandMetadataSchema = object({
  name: string(),
  description: string(),
  search_terms: string(),
  category: string(),
  signatures: optional(commandSignaturesSchema),
  type: string(),
});

export type CommandMetadata = InferOutput<typeof CommandMetadataSchema>;
export interface CommandCompletionItem extends AutocompleteItem {
  requiresClosure: boolean;
}

function isClosureFirstCommand(command: CommandMetadata) {
  const signatureTexts = JSON.stringify(command.signatures ?? "").toLowerCase();

  return signatureTexts.includes("closure") || signatureTexts.includes("block");
}

function buildCommandCompletionItem(
  command: CommandMetadata,
): CommandCompletionItem {
  const label = command.name ?? "";
  return {
    value: label,
    label,
    description: command.description,
    requiresClosure: isClosureFirstCommand(command),
  };
}

export async function getCommandSuggestions(prefix: string): Promise<
  | (Pick<AutocompleteSuggestions, "prefix"> & {
      items: Array<CommandCompletionItem>;
    })
  | null
> {
  const safePrefix = prefix.replace(/'/g, "''");
  const command = prefix
    ? `scope commands
    | select name description signatures type category search_terms
    | where (($it.name | default "")
    | str starts-with '${safePrefix}') or (($it.description | default "")
    | str starts-with '${safePrefix}') or ($it.category == '${safePrefix}') or ($it.search_terms | str contains '${safePrefix}')
    | to json`
    : `scope commands | select name description signatures type category search_terms | to json`;

  const result = await new Promise<string>((resolve, reject) => {
    const child = spawn("nu", ["-c", command], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const stdout: Buffer[] = [];

    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.on("close", () => {
      resolve(Buffer.concat(stdout).toString("utf-8"));
    });
    child.on("error", reject);
  });

  if (!result) return null;
  const safeParseResult = safeParse(
    array(CommandMetadataSchema),
    JSON.parse(result),
  );

  if (!safeParseResult.success) {
    safeParseResult.issues.forEach((item) => {
      console.dir(item, { depth: 3 });
    });
    return null;
  }
  const commands = safeParseResult.output;
  return commands.length > 0
    ? { prefix, items: commands.map(buildCommandCompletionItem) }
    : null;
}
