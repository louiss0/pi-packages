import {
  ConfirmationBox,
  Form,
  LabelledInput,
} from "@code-fixer-23/pi-form-components";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Container,
  Editor,
  Key,
  matchesKey,
  Spacer,
  Text,
  type Focusable,
  type TUI,
} from "@earendil-works/pi-tui";
import {
  type InferOutput,
  maxLength,
  minLength,
  object,
  optional,
  pipe,
  regex,
  string,
} from "valibot";

import { parseObjectErrors } from "./parse";

const agentNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const lowerCommaSeparatedToolsPattern = /^[a-z0-9:-]+(?:\s*,\s*[a-z0-9:-]+)*$/;
const promptNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const argumentHintPattern =
  /^(?!.*\[[^\]]*\[)(?:\s*(?:<[^<>\s]+>|\[[^\]\s]+\])\s*)*$/;
const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const pathLikePattern =
  /^(?:$|~?[/.\\]|[A-Za-z]:[\\/]|\.\.?[\\/]|[^<>:"|?*\r\n]+(?:[\\/][^<>:"|?*\r\n]+)*)$/;
const commaSeparatedAllowedToolsPattern =
  /^(?:$|[a-z][a-z0-9-]*(?:\s*,\s*[a-z][a-z0-9-]*)*)$/;

const AgentFieldsSchema = object({
  name: pipe(
    string(),
    minLength(1, "Name is required"),
    maxLength(48, "Name must be 48 characters or fewer"),
    regex(
      agentNamePattern,
      "Name must be lowercase letters, numbers, and dashes only",
    ),
  ),
  description: pipe(
    string(),
    minLength(35, "Description must be at least 35 characters"),
    maxLength(1024, "Description must be 1024 characters or fewer"),
  ),
  tools: pipe(
    string(),
    minLength(1, "Tools are required"),
    regex(
      lowerCommaSeparatedToolsPattern,
      "Tools must be a lowercase comma-separated list",
    ),
  ),
  model: pipe(
    string(),
    minLength(2, "Model must be at least 2 characters"),
    maxLength(128, "Model must be 128 characters or fewer"),
    regex(/^[a-z0-9:-]+$/, "Model must be lowercase"),
  ),
});

const PromptFieldsSchema = object({
  name: pipe(
    string(),
    minLength(3, "Name must be at least 3 characters"),
    maxLength(48, "Name must be 48 characters or fewer"),
    regex(
      promptNamePattern,
      "Name must be lowercase letters, numbers, and dashes only",
    ),
  ),
  description: pipe(
    string(),
    minLength(35, "Description must be at least 35 characters"),
    maxLength(1024, "Description must be 1024 characters or fewer"),
  ),
  "argument-hint": optional(
    pipe(
      string(),
      regex(argumentHintPattern, "Argument hint must use [] or <> tokens"),
    ),
    "",
  ),
});

const RequiredSkillFieldsSchema = object({
  name: pipe(
    string(),
    minLength(1, "Name is required"),
    maxLength(164, "Name must be 164 characters or fewer"),
    regex(skillNamePattern, "Must be lowercase alphanumeric with dashes only"),
  ),
  description: pipe(
    string(),
    minLength(1, "Description is required"),
    maxLength(1024, "Description must be 1024 characters or fewer"),
  ),
});

const OptionalSkillFieldsSchema = object({
  license: optional(
    pipe(string(), regex(pathLikePattern, "License must be a valid path")),
    "",
  ),
  compatibility: optional(
    pipe(
      string(),
      maxLength(500, "Compatibility must be 500 characters or fewer"),
    ),
    "",
  ),
  allowedTools: optional(
    pipe(
      string(),
      regex(
        commaSeparatedAllowedToolsPattern,
        "Allowed tools must be a comma-separated list",
      ),
    ),
    "",
  ),
});

export type AgentFields = InferOutput<typeof AgentFieldsSchema>;
export type PromptFields = InferOutput<typeof PromptFieldsSchema>;
export type RequiredSkillFields = InferOutput<typeof RequiredSkillFieldsSchema>;
export type OptionalSkillFields = InferOutput<typeof OptionalSkillFieldsSchema>;
export type SkillFrontmatterFields = RequiredSkillFields & OptionalSkillFields;

export function parseAgentFormValues(values: AgentFields) {
  return parseObjectErrors(AgentFieldsSchema, values);
}

export function createAgentForm(
  tui: TUI,
  theme: Theme,
  done: (value: AgentFields | null) => void,
) {
  return new Form<AgentFields>(
    {
      title: "Create Agent",
      fields: [
        new LabelledInput("name", theme),
        new LabelledInput("description", theme),
        new LabelledInput("tools", theme),
        new LabelledInput("model", theme),
      ],
      parse: parseAgentFormValues,
      footer:
        "* required | Enter next/submit | Tab switch field | Esc cancel\nUse lowercase values for every field. Separate tools with commas.",
      spacing: 1,
    },
    tui,
    done,
  );
}

export function renderAgentFrontmatter(values: AgentFields) {
  return [
    "---",
    ...Object.entries(values).map(([key, value]) => `${key}: ${value}`),
    "---",
    "",
  ].join("\n");
}

export function parsePromptFormValues(values: PromptFields) {
  return parseObjectErrors(PromptFieldsSchema, values);
}

export function createPromptForm(
  tui: TUI,
  theme: Theme,
  done: (value: PromptFields | null) => void,
) {
  return new Form<PromptFields>(
    {
      title: "Create Prompt",
      fields: [
        new LabelledInput("name", theme),
        new LabelledInput("description", theme),
        new LabelledInput("argument-hint", theme),
      ],
      parse: parsePromptFormValues,
      footer:
        "* required | argument-hint is optional | Enter next/submit | Tab switch field | Esc cancel\nTemplate opens in the editor overlay next. Use <> for required hints and [] for optional hints.",
      spacing: 1,
    },
    tui,
    done,
  );
}

export class PromptTemplateOverlay extends Container {
  #editor: Editor;
  #done: (value: string | undefined) => void;

  constructor(
    tui: TUI,
    theme: Theme,
    done: (value: string | undefined) => void,
  ) {
    super();
    this.#done = done;
    this.#editor = new Editor(tui, {
      borderColor: (text) => theme.fg("accent", text),
      selectList: {
        selectedPrefix: (text) => theme.fg("accent", text),
        selectedText: (text) => theme.fg("accent", text),
        description: (text) => theme.fg("muted", text),
        scrollInfo: (text) => theme.fg("dim", text),
        noMatch: (text) => theme.fg("warning", text),
      },
    });

    this.#editor.onSubmit = (value) => done(value);

    this.addChild(new Text(theme.fg("accent", "Edit Prompt Template")));
    this.addChild(new Spacer(1));
    this.addChild(this.#editor);
    this.addChild(new Spacer(1));
    this.addChild(
      new Text(
        theme.fg(
          "dim",
          "* required in form | argument-hint optional | Enter submit | Shift+Enter newline | Esc cancel",
        ),
      ),
    );
  }

  handleInput(data: string) {
    if (matchesKey(data, Key.escape)) {
      this.#done(undefined);
      return;
    }

    this.#editor.handleInput(data);
  }
}

export function renderPromptFrontmatter(values: PromptFields) {
  return [
    "---",
    ...Object.entries(values).map(([key, value]) => `${key}: ${value}`),
    "---",
    "",
  ].join("\n");
}

export function renderPromptMarkdown(values: PromptFields, template: string) {
  return `${renderPromptFrontmatter(values)}\n${template}`.trimEnd() + "\n";
}

export function parseRequiredSkillFormValues(values: RequiredSkillFields) {
  return parseObjectErrors(RequiredSkillFieldsSchema, values);
}

export function parseOptionalSkillFormValues(values: OptionalSkillFields) {
  return parseObjectErrors(OptionalSkillFieldsSchema, values);
}

export function createRequiredSkillForm(
  tui: TUI,
  theme: Theme,
  done: (value: (RequiredSkillFields & { confirm: boolean }) | null) => void,
) {
  return new Form<RequiredSkillFields & { confirm: boolean }>(
    {
      title: "Create Skill",
      fields: [
        new LabelledInput("name", theme),
        new LabelledInput("description", theme),
        new ConfirmationBox(theme, "Do you want to fill in the next fields?"),
      ],
      parse: (values) =>
        parseRequiredSkillFormValues({
          name: values.name,
          description: values.description,
        }),
      footer: "Enter next/submit | Tab switch field | Esc cancel",
      spacing: 1,
    },
    tui,
    done,
  );
}

export function createOptionalSkillForm(
  tui: TUI,
  theme: Theme,
  done: (value: OptionalSkillFields | null) => void,
) {
  return new Form<OptionalSkillFields>(
    {
      title: "Skill Details",
      fields: [
        new LabelledInput("license", theme),
        new LabelledInput("compatibility", theme),
        new LabelledInput("allowedTools", theme),
      ],
      parse: (values) => parseOptionalSkillFormValues(values),
      footer: "Enter next/submit | Tab switch field | Esc cancel",
      spacing: 1,
    },
    tui,
    done,
  );
}

export class SkillEditorOverlay extends Container implements Focusable {
  #editor: Editor;
  #focused = false;
  #done: (value: string | undefined) => void;

  get focused() {
    return this.#focused;
  }

  set focused(value: boolean) {
    this.#focused = value;
    this.#editor.focused = value;
  }

  constructor(
    tui: TUI,
    theme: Theme,
    initialValue: string,
    done: (value: string | undefined) => void,
  ) {
    super();
    this.#done = done;

    this.#editor = new Editor(tui, {
      borderColor: (text) => theme.fg("accent", text),
      selectList: {
        selectedPrefix: (text) => theme.fg("accent", text),
        selectedText: (text) => theme.fg("accent", text),
        description: (text) => theme.fg("muted", text),
        scrollInfo: (text) => theme.fg("dim", text),
        noMatch: (text) => theme.fg("warning", text),
      },
    });
    this.#editor.setText(initialValue);
    this.#editor.onSubmit = (value) => done(value);

    this.addChild(new Text(theme.fg("accent", "Edit Skill Markdown")));
    this.addChild(new Spacer(1));
    this.addChild(this.#editor);
    this.addChild(new Spacer(1));
    this.addChild(
      new Text(
        theme.fg("dim", "Enter submit | Shift+Enter newline | Esc cancel"),
      ),
    );
  }

  handleInput(data: string) {
    if (matchesKey(data, Key.escape)) {
      this.#done(undefined);
      return;
    }

    this.#editor.handleInput(data);
  }
}

export function renderSkillMarkdown(fields: SkillFrontmatterFields) {
  const frontmatter = [
    "---",
    `name: ${formatYamlValue(fields.name)}`,
    `description: ${formatYamlValue(fields.description)}`,
    ...(fields.license ? [`license: ${formatYamlValue(fields.license)}`] : []),
    ...(fields.compatibility
      ? [`compatibility: ${formatYamlValue(fields.compatibility)}`]
      : []),
    ...(fields.allowedTools
      ? [`allowed-tools: ${formatYamlValue(fields.allowedTools)}`]
      : []),
    "---",
  ].join("\n");

  return `${frontmatter}\n\n# ${humanizeSkillName(fields.name)}\n\n${fields.description}\n`;
}

function formatYamlValue(value: string) {
  const yamlSpecialCharacters = [
    ":",
    "#",
    "'",
    '"',
    "{",
    "}",
    "[",
    "]",
    ",",
    "&",
    "*",
    "!",
    "?",
    "|",
    ">",
    "@",
    "`",
    "%",
  ];
  const includesYamlSpecialCharacter = yamlSpecialCharacters.some((character) =>
    value.includes(character),
  );
  const canUsePlainValue =
    value.length > 0 &&
    !value.includes("\n") &&
    !value.includes("\r") &&
    !/^[\s]|[\s]$/.test(value) &&
    !includesYamlSpecialCharacter;

  if (canUsePlainValue) {
    return value;
  }

  return `'${value.replaceAll("'", "''")}'`;
}

function humanizeSkillName(name: string) {
  return name
    .split("-")
    .map((segment) => `${segment[0]?.toUpperCase() ?? ""}${segment.slice(1)}`)
    .join(" ");
}
