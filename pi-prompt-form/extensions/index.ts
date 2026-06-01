import {
  parseArgumentHint,
  parsePlaceholders,
  parseTemplate,
} from "@code-fixer-23/pi-prompt-parser";
import {
  ConfirmationBox,
  Form,
  LabelledInput,
  type FormField,
} from "@code-fixer-23/pi-form-components";
import {
  type ExtensionAPI,
  type ExtensionUIContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { readFile } from "node:fs/promises";
import {
  boolean,
  minLength,
  object,
  optional,
  pipe,
  safeParse,
  string,
  type BaseIssue,
  type StringIssue,
} from "valibot";

const formOverlayOptions = {
  overlay: true,
  overlayOptions: {
    offsetY: -250,
  },
} as const;

type PromptArgument = Exclude<ReturnType<typeof parseArgumentHint>, Error>[number];

type SlashCommandInfo = ReturnType<ExtensionAPI["getCommands"]>[number];

type PromptCommand = Pick<SlashCommandInfo, "name" | "source"> & {
  sourceInfo: Pick<SlashCommandInfo["sourceInfo"], "path">;
};

type TokenizedPromptInput = {
  commandName: string;
  passedArguments: string[];
};

type PromptArgumentValue = string | boolean;

type PromptArgumentValues = Record<string, PromptArgumentValue>;

type PromptArgumentField = PromptArgument & {
  initialValue: PromptArgumentValue;
};

export default function (pi: ExtensionAPI) {
  pi.on("input", async (event, ctx) => {
    return handlePromptInput({
      text: event.text,
      hasUI: ctx.hasUI,
      ui: ctx.ui,
      getCommands: () => pi.getCommands(),
      readPromptFile: (path) => readFile(path, "utf-8"),
    });
  });
}

type PromptInputContext = {
  text: string;
  hasUI: boolean;
  ui: Pick<ExtensionUIContext, "confirm" | "custom" | "input" | "notify">;
  getCommands: () => PromptCommand[];
  readPromptFile: (path: string) => Promise<string>;
};

export async function handlePromptInput({
  text,
  hasUI,
  ui,
  getCommands,
  readPromptFile,
}: PromptInputContext) {
  if (!hasUI || !text.startsWith("/")) {
    return { action: "continue" } as const;
  }

  const tokenizedInput = tokenizePromptInput(text);

  if (tokenizedInput instanceof Error) {
    ui.notify(tokenizedInput.message, "error");
    return { action: "handled" } as const;
  }

  const { commandName, passedArguments } = tokenizedInput;

  if (!commandName) {
    return { action: "continue" } as const;
  }

  const promptCommand = getCommands()
    .filter((command) => command.source === "prompt")
    .find((command) => command.name === commandName);

  if (!promptCommand) {
    return { action: "continue" } as const;
  }

  const markdown = await readPromptFile(promptCommand.sourceInfo.path);
  const template = parseTemplate(markdown);
  const parsedArguments = parseArgumentHint(template.argumentHint);

  if (parsedArguments instanceof Error) {
    ui.notify(parsedArguments.message, "error");
    return { action: "handled" } as const;
  }

  const parsedPlaceholders = parsePlaceholders(template.content);

  if (parsedPlaceholders instanceof Error) {
    ui.notify(parsedPlaceholders.message, "error");
    return { action: "handled" } as const;
  }

  if (parsedArguments.length === 0) {
    const extraValue = await maybeCollectExtraValue({
      ui,
      commandName,
      placeholders: parsedPlaceholders,
      initialValue: passedArguments.join(" "),
    });

    if (extraValue === null) {
      ui.notify(`Prompt /${commandName} cancelled`, "info");
      return { action: "handled" } as const;
    }

    return {
      action: "transform",
      text: buildPromptWithExtraValue(commandName, [], extraValue),
    } as const;
  }

  const argumentFields = createPromptArgumentFields(parsedArguments, passedArguments);
  const values = await ui.custom<PromptArgumentValues | null>(
    (tui, theme, _keyboard, done) =>
      createPromptArgumentsForm({
        commandName,
        argumentFields,
        tui,
        theme,
        done,
      }),
    formOverlayOptions,
  );

  if (values === null) {
    ui.notify(`Prompt /${commandName} cancelled`, "info");
    return { action: "handled" } as const;
  }

  const extraValue = await maybeCollectExtraValue({
    ui,
    commandName,
    placeholders: parsedPlaceholders,
    initialValue: passedArguments.slice(parsedArguments.length).join(" "),
  });

  if (extraValue === null) {
    ui.notify(`Prompt /${commandName} cancelled`, "info");
    return { action: "handled" } as const;
  }

  return {
    action: "transform",
    text: buildPromptInvocation(commandName, argumentFields, values, extraValue),
  } as const;
}

export function tokenizePromptInput(text: string): TokenizedPromptInput | Error {
  const tokens: string[] = [];
  let currentToken = "";
  let activeQuote: '"' | "'" | null = null;

  for (const character of text.trim()) {
    if (activeQuote) {
      if (character === activeQuote) {
        activeQuote = null;
      } else {
        currentToken += character;
      }

      continue;
    }

    if (character === '"' || character === "'") {
      activeQuote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (currentToken) {
        tokens.push(currentToken);
        currentToken = "";
      }

      continue;
    }

    currentToken += character;
  }

  if (activeQuote) {
    return new Error(
      "Unterminated quoted argument.\nIf an argument contains spaces, wrap it in single or double quotes.",
    );
  }

  if (currentToken) {
    tokens.push(currentToken);
  }

  const [unparsedCommandName, ...passedArguments] = tokens;
  const commandName = unparsedCommandName?.replace(/^\/+/, "") ?? "";

  return {
    commandName,
    passedArguments,
  };
}

function createPromptArgumentFields(
  promptArguments: PromptArgument[],
  passedArguments: string[],
): PromptArgumentField[] {
  return promptArguments.map((argument, index) => ({
    ...argument,
    initialValue: argument.required
      ? (passedArguments[index] ?? "")
      : passedArguments[index] === argument.name,
  }));
}

type PromptArgumentsSchema = Parameters<typeof safeParse>[0];

type PromptArgumentsFormOptions = {
  commandName: string;
  argumentFields: PromptArgumentField[];
  tui: TUI;
  theme: Theme;
  done: (value: PromptArgumentValues | null) => void;
};

export function createPromptArgumentsForm({
  commandName,
  argumentFields,
  tui,
  theme,
  done,
}: PromptArgumentsFormOptions) {
  const schema = createPromptArgumentsSchema(argumentFields);

  return new Form<Record<string, string | boolean>>(
    {
      title: `Fill /${commandName}`,
      fields: createPromptFormFields(argumentFields, theme),
      parse: (values) => parsePromptArgumentValues(schema, values),
      footer:
        "Enter next/submit | Tab switch field | Esc cancel\nRequired arguments come from <> and optional arguments come from [].",
      spacing: 1,
    },
    tui as never,
    done,
  );
}

function createPromptFormFields(
  argumentFields: PromptArgumentField[],
  theme: Theme,
): FormField[] {
  return argumentFields.map((argument) => {
    if (argument.required) {
      return new LabelledInput(
        argument.name,
        theme as never,
        argument.initialValue as string,
      );
    }

    const checkbox = new ConfirmationBox(
      theme as never,
      argument.name,
      argument.name,
    );

    if (argument.initialValue === true) {
      checkbox.confirm();
    }

    return checkbox;
  });
}

function createPromptArgumentsSchema(argumentFields: PromptArgumentField[]) {
  const entries = Object.fromEntries(
    argumentFields.map((argument) => [
      argument.name,
      argument.required
        ? pipe(string(), minLength(1, `${argument.name} is required`))
        : optional(boolean(), false),
    ]),
  );

  return object(entries as never);
}

function parsePromptArgumentValues(
  schema: PromptArgumentsSchema,
  values: PromptArgumentValues,
) {
  const result = safeParse(schema, values);

  if (result.success) {
    return undefined;
  }

  const errors = new Map<string, string>();

  for (const issue of result.issues as Array<BaseIssue<unknown> | StringIssue>) {
    const key = issue.path?.[0]?.key;

    if (typeof key !== "string") {
      continue;
    }

    const currentError = errors.get(key);
    errors.set(
      key,
      currentError ? `${currentError}\n${issue.message}` : issue.message,
    );
  }

  return Object.fromEntries(errors.entries()) as Record<string, string>;
}

type MaybeCollectExtraValueOptions = {
  ui: Pick<ExtensionUIContext, "confirm" | "input">;
  commandName: string;
  placeholders: Exclude<ReturnType<typeof parsePlaceholders>, Error>;
  initialValue: string;
};

async function maybeCollectExtraValue({
  ui,
  commandName,
  placeholders,
  initialValue,
}: MaybeCollectExtraValueOptions) {
  const supportsExtraValue = placeholders.some(
    (placeholder) =>
      placeholder.kind === "named" || placeholder.kind === "rest",
  );

  if (!supportsExtraValue) {
    return initialValue;
  }

  const shouldCollectExtraValue = await ui.confirm(
    `Add more info to /${commandName}?`,
    "This prompt supports extra trailing info through $ARGUMENTS or $@.",
  );

  if (!shouldCollectExtraValue) {
    return initialValue;
  }

  const extraValue = await ui.input(
    `Extra info for /${commandName}`,
    initialValue,
  );

  return extraValue === undefined ? null : extraValue.trim();
}

function buildPromptWithExtraValue(
  commandName: string,
  serializedArguments: string[],
  extraValue: string,
) {
  const commandParts = [`/${commandName}`, ...serializedArguments];
  const commandText = commandParts.join(" ").trim();

  return extraValue.length === 0 ? commandText : `${commandText} ${extraValue}`;
}

export function buildPromptInvocation(
  commandName: string,
  argumentFields: PromptArgumentField[],
  values: PromptArgumentValues,
  extraValue = "",
) {
  const serializedArguments = argumentFields.map((argument) => {
    const value = values[argument.name];

    if (argument.required) {
      return typeof value === "string" ? value.trim() : "";
    }

    return value === true ? argument.name : "";
  });

  while (serializedArguments.at(-1) === "") {
    serializedArguments.pop();
  }

  const quotedArguments = serializedArguments.map(quotePromptArgument);

  return buildPromptWithExtraValue(commandName, quotedArguments, extraValue);
}

function quotePromptArgument(value: string) {
  if (value.length === 0) {
    return value;
  }

  if (!/\s|["']/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}
