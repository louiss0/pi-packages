import { picklist, safeParse, summarize } from "valibot";

const SUBCOMMANDS = picklist(["create", "edit", "delete"]);

function createEnum<const T extends string>(values: T[]) {
  const enumMap = values.reduce((acc, value) => {
    acc.set(value.toUpperCase(), value);
    return acc;
  }, new Map<string, T>());

  return Object.freeze(
    Object.assign(
      Object.fromEntries(enumMap) as {
        [key in (typeof values)[number] as Uppercase<key>]: key;
      },
      {
        validate: (argument: string) => {
          const result = safeParse(SUBCOMMANDS, argument);

          if (!result.success) {
            return true;
          }

          return false;
        },
        values: SUBCOMMANDS.options,
        parse: (argument: string) => {
          const result = safeParse(SUBCOMMANDS, argument);

          if (!result.success) {
            return {
              success: result.success,
              errorMessage: summarize(result.issues),
            };
          }

          return { success: result.success, output: result.output };
        },
      },
    ),
  );
}

export const SubCommands = createEnum(SUBCOMMANDS.options);

export function getFilterSubcommandArgumentCompletionFromStringUsingSubLabel(subLabel: string) {
  const completions = generateSubcommandArgumentCompletionsUsingSubLabel(subLabel);
  return (value: string) =>
    completions.filter((completion) => completion.value.startsWith(value));
}

export function generateSubcommandArgumentCompletionsUsingSubLabel(subLabel: string) {
  return SubCommands.values.map((option) =>
    option === "create"
      ? {
          label: `${option}:${subLabel}`,
          value: option,
          description: `${option[0].toUpperCase()}${option.substring(1)} a new ${subLabel}`,
        }
      : {
          label: `${option}:${subLabel}`,
          value: option,
          description: `${option[0].toUpperCase()}${option.substring(1)} a ${subLabel}`,
        },
  );
}
