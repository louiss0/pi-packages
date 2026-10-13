import { isMap, parseDocument, stringify } from "yaml";

export type AgentRuntime = "tintin" | "nico";
export type AgentValue =
  | string
  | number
  | boolean
  | null
  | AgentValue[]
  | { [key: string]: AgentValue };
export type AgentFrontmatter = Record<string, AgentValue>;
export type AgentValueKind =
  | "string"
  | "boolean"
  | "integer"
  | "list"
  | "map"
  | "null";
export interface AgentFieldDefinition {
  key: string;
  group: string;
  description: string;
  kinds: readonly AgentValueKind[];
  choices?: readonly string[];
  children?: readonly AgentFieldDefinition[];
  openMap?: boolean;
}

// File-authoring contracts, not settings or tool-call schemas. Sources:
// tintinweb/pi-subagents README (Custom Agents / scoping), src/custom-agents.ts;
// nicobailon/pi-subagents docs/agents.md, src/agents/{agents,agent-serializer}.ts,
// src/runs/shared/{acceptance,external-cli-contract,permissions,tool-budget}.ts.
// Omission is intentional: no loader defaults are materialized here. This is
// structured authoring validation, NOT evidence of either actual loader's behavior.
const thinking = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const levels = ["auto", "none", "attested", "checked", "verified"];
const adapters = [
  "codex-exec",
  "codex-exec-writer",
  "claude-code",
  "claude-code-writer",
  "cursor-agent",
  "cursor-agent-writer",
];
const evidence = [
  "changed-files",
  "tests-added",
  "commands-run",
  "validation-output",
  "residual-risks",
  "no-staged-files",
  "diff-summary",
  "review-findings",
  "manual-notes",
];
const capabilityKeys = [
  "steer",
  "resume",
  "structuredOutput",
  "toolEvents",
  "supervisor",
  "forkContext",
  "extensionBindings",
];
const field = (
  key: string,
  group: string,
  description: string,
  kinds: readonly AgentValueKind[],
  extra: Pick<AgentFieldDefinition, "choices" | "children" | "openMap"> = {},
): AgentFieldDefinition => ({ key, group, description, kinds, ...extra });
const text = (
  key: string,
  group: string,
  description: string,
  nullable = false,
) => field(key, group, description, nullable ? ["string", "null"] : ["string"]);
const bool = (
  key: string,
  group: string,
  description: string,
  nullable = false,
) =>
  field(key, group, description, nullable ? ["boolean", "null"] : ["boolean"]);
const csv = (
  key: string,
  group: string,
  description: string,
  inherit = false,
) =>
  field(
    key,
    group,
    `${description} Accepts comma-separated text or a list of strings; omission is distinct from empty.`,
    inherit
      ? ["string", "list", "boolean", "null"]
      : ["string", "list", "null"],
  );
const enumeration = (
  key: string,
  group: string,
  description: string,
  choices: readonly string[],
  nullable = false,
) =>
  field(key, group, description, nullable ? ["string", "null"] : ["string"], {
    choices,
  });
const integer = (
  key: string,
  group: string,
  description: string,
  nullable = false,
) =>
  field(key, group, description, nullable ? ["integer", "null"] : ["integer"]);
const map = (
  key: string,
  group: string,
  description: string,
  children: readonly AgentFieldDefinition[],
  nullable = false,
) =>
  field(key, group, description, nullable ? ["map", "null"] : ["map"], {
    children,
  });
const arbitrary = (key: string, group: string, description: string) =>
  field(key, group, description, ["map"], { openMap: true });
const list = (
  key: string,
  group: string,
  description: string,
  children?: readonly AgentFieldDefinition[],
  choices?: readonly string[],
) =>
  field(key, group, description, ["list"], {
    ...(children ? { children } : {}),
    ...(choices ? { choices } : {}),
  });

const acceptanceFields: readonly AgentFieldDefinition[] = [
  enumeration(
    "level",
    "Acceptance",
    "Requested level; none needs a reason, verified needs runtime commands.",
    levels,
  ),
  enumeration(
    "report",
    "Acceptance",
    "Structured acceptance report policy; requires outputSchema.",
    ["on", "off"],
  ),
  bool(
    "preserveStagedIndex",
    "Acceptance",
    "Only true is accepted, with checked or verified level.",
  ),
  list("criteria", "Acceptance", "Strings or structured acceptance gates.", [
    text(
      "id",
      "Acceptance",
      "Required gate identifier; normalized identifiers must be unique.",
    ),
    text("must", "Acceptance", "Required non-empty criterion."),
    list(
      "evidence",
      "Acceptance",
      "Evidence kinds for this gate.",
      undefined,
      evidence,
    ),
    enumeration("severity", "Acceptance", "Gate severity.", [
      "required",
      "recommended",
    ]),
  ]),
  list(
    "evidence",
    "Acceptance",
    "Required evidence kinds.",
    undefined,
    evidence,
  ),
  list("verify", "Acceptance", "Runtime verification commands (objects).", [
    text("id", "Acceptance", "Required command identifier."),
    text("command", "Acceptance", "Required command to execute."),
    integer(
      "timeoutMs",
      "Acceptance",
      "Positive integer command deadline in milliseconds.",
    ),
    text("cwd", "Acceptance", "Verification working directory."),
    arbitrary(
      "env",
      "Acceptance",
      "Arbitrary environment variable names with string values.",
    ),
    bool("allowFailure", "Acceptance", "Whether the command may fail."),
    enumeration("output", "Acceptance", "Typed verification output.", ["json"]),
    arbitrary(
      "schema",
      "Acceptance",
      "Arbitrary JSON Schema keywords; requires output: json.",
    ),
  ]),
  field(
    "review",
    "Acceptance",
    "False disables review; a map declares an independent review gate.",
    ["boolean", "map"],
    {
      children: [
        text("agent", "Acceptance", "Review agent name."),
        text("focus", "Acceptance", "Review focus."),
        bool("required", "Acceptance", "Whether review is required."),
      ],
    },
  ),
  list("stopRules", "Acceptance", "Strings describing stop rules."),
  text(
    "reason",
    "Acceptance",
    "Reason; required and non-empty for level none.",
  ),
];
const runnerFields: readonly AgentFieldDefinition[] = [
  enumeration(
    "type",
    "Runner",
    "Required runner type. Pi accepts only type; external runners have different controls.",
    ["pi", "external-cli", "external-job"],
  ),
  text(
    "provider",
    "Runner",
    "Required non-empty trimmed external-job provider identifier.",
  ),
  arbitrary(
    "options",
    "Runner",
    "External-job provider-owned options: arbitrary finite JSON-compatible values.",
  ),
  text(
    "command",
    "Runner",
    "Required external-cli executable; discovery does not probe availability.",
  ),
  list(
    "args",
    "Runner",
    "External-cli string arguments; code-owned adapters own argv and forbid non-empty args.",
  ),
  enumeration(
    "adapter",
    "Runner",
    "Optional code-owned external-cli adapter.",
    adapters,
  ),
  enumeration("promptDelivery", "Runner", "External-cli prompt delivery.", [
    "stdin",
  ]),
  map(
    "capabilities",
    "Runner",
    "External-cli capability narrowing only; every supplied value must be false.",
    capabilityKeys.map((key) =>
      bool(key, "Runner", "Only false: cannot widen adapter capabilities."),
    ),
  ),
];

export const AGENT_PROFILES: Record<
  AgentRuntime,
  { label: string; fields: readonly AgentFieldDefinition[]; recursive: boolean }
> = {
  tintin: {
    label: "@tintinweb/pi-subagents",
    recursive: false,
    fields: [
      text(
        "name",
        "Identity",
        "Dispatch identity; defaults to filename. Colon is reserved; spaces and mixed case are allowed.",
        true,
      ),
      text(
        "display_name",
        "Identity",
        "Cosmetic UI label; does not change dispatch identity.",
        true,
      ),
      text("description", "Identity", "Description in tool listings.", true),
      text(
        "color",
        "Identity",
        "Badge color name/alias or quoted six-digit hex; invalid colors simply render no badge.",
        true,
      ),
      bool("enabled", "Identity", "False disables this agent.", true),
      csv(
        "tools",
        "Tools",
        "Builtins, all/*, none, and ext:<extension>[/<tool>] selectors. Selectors do not load providers.",
      ),
      csv(
        "extensions",
        "Tools",
        "True inherits extensions; false disables; explicit names/paths select providers.",
        true,
      ),
      csv(
        "inherit_extensions",
        "Tools",
        "Compatibility alias for extensions (extensions takes precedence).",
        true,
      ),
      csv(
        "exclude_extensions",
        "Tools",
        "Extension denylist; plain case-insensitive names, no paths or wildcard.",
      ),
      csv(
        "disallowed_tools",
        "Tools",
        "Tool denylist, including extension tools.",
      ),
      csv(
        "skills",
        "Context",
        "True inherits skills; false disables; explicit names preload only those skills.",
        true,
      ),
      csv(
        "inherit_skills",
        "Context",
        "Compatibility alias for skills (skills takes precedence).",
        true,
      ),
      enumeration(
        "memory",
        "Context",
        "Persistent memory scope; writer/read-only handling belongs to runtime.",
        ["project", "local", "user"],
        true,
      ),
      text(
        "model",
        "Model",
        "Provider/modelId or fuzzy model name; no local registry resolution.",
        true,
      ),
      enumeration(
        "thinking",
        "Model",
        "Thinking level; runtime clamps unsupported levels.",
        thinking,
        true,
      ),
      integer(
        "max_turns",
        "Execution",
        "Non-negative integer; zero or omission means unlimited.",
        true,
      ),
      bool(
        "persist_session",
        "Execution",
        "Persist Pi session independently of the output transcript.",
        true,
      ),
      bool(
        "output_transcript",
        "Execution",
        "Write the .output transcript independently of session persistence.",
        true,
      ),
      text(
        "session_dir",
        "Execution",
        "Session directory; relative paths resolve from agent cwd.",
        true,
      ),
      field(
        "isolation",
        "Execution",
        "Worktree isolation, or authoritative off veto (none/no/false are off aliases).",
        ["string", "boolean", "null"],
        { choices: ["worktree", "off", "none", "no"] },
      ),
      csv(
        "allowed_subagents",
        "Delegation",
        "Privilege boundary: true/all/* permits all enabled agents; false/none/empty disables. Isolated agents cannot delegate.",
        true,
      ),
      enumeration(
        "prompt_mode",
        "Context",
        "Replace the full prompt or append to the parent's prompt.",
        ["replace", "append"],
        true,
      ),
      bool(
        "inherit_context",
        "Context",
        "Fork the parent conversation on supported spawn paths.",
        true,
      ),
      bool(
        "run_in_background",
        "Execution",
        "Pin background or foreground; omit to use native project policy.",
        true,
      ),
      bool(
        "isolated",
        "Execution",
        "Hermetic builtin-only specialist (not filesystem worktree isolation).",
        true,
      ),
    ],
  },
  nico: {
    label: "nicobailon/pi-subagents",
    recursive: true,
    fields: [
      text(
        "name",
        "Identity",
        "Required local agent name; package adds a namespace.",
      ),
      text("description", "Identity", "Required specialist description."),
      field(
        "package",
        "Identity",
        "Optional namespace; normalized to lowercase dotted/hyphenated identifier. False clears it.",
        ["string", "boolean"],
      ),
      bool("advertise", "Identity", "Opt in to the parent-prompt catalog."),
      csv(
        "aliases",
        "Identity",
        "Additional selection names; canonical identity remains unchanged.",
      ),
      csv(
        "alias",
        "Identity",
        "Compatibility alias for aliases (aliases takes precedence).",
      ),
      csv(
        "tools",
        "Tools",
        "Strict child allowlist, including paths/extensions and mcp:server[/tool]. Provider loading is separate.",
      ),
      csv(
        "excludeTools",
        "Tools",
        "Denylist applied after tool resolution; unknown names are runtime-tolerated.",
      ),
      csv(
        "extensions",
        "Tools",
        "Omitted background policy inherits ambient extensions; empty disables ambient discovery.",
      ),
      csv(
        "subagentOnlyExtensions",
        "Tools",
        "Provider paths loaded only inside this agent's child sessions.",
      ),
      csv(
        "mutationTools",
        "Tools",
        "Extension tools counted as mutating diagnostics only; not proof of completion.",
      ),
      text(
        "model",
        "Model",
        "Model alias, provider/id, or model:level suffix; :high may request effort alone.",
        true,
      ),
      bool("fast", "Model", "Native Pi fast-mode preference."),
      field(
        "thinking",
        "Model",
        "Thinking level; false disables thinking. A model suffix wins.",
        ["string", "boolean", "null"],
        { choices: thinking },
      ),
      enumeration(
        "systemPromptMode",
        "Context",
        "Replace or append Pi's base prompt; omit for native defaults.",
        ["replace", "append"],
        true,
      ),
      bool(
        "inheritProjectContext",
        "Context",
        "Include repository instructions.",
        true,
      ),
      bool(
        "inheritGlobalContext",
        "Context",
        "Include global instructions only when project context is inherited.",
        true,
      ),
      bool(
        "inheritSkills",
        "Context",
        "Include the discovered skills catalog.",
        true,
      ),
      enumeration(
        "defaultContext",
        "Context",
        "Default launch context; implicit fork may fall back to fresh.",
        ["fresh", "fork"],
        true,
      ),
      csv(
        "skills",
        "Context",
        "Select specific skills regardless of inheritSkills.",
      ),
      csv("skill", "Context", "Compatibility spelling for skills."),
      csv(
        "skillPath",
        "Context",
        "Private discovery paths relative to this file; skills still selects candidates.",
      ),
      map(
        "memory",
        "Context",
        "Role-specific memory; no settings/session memory collision.",
        [
          enumeration("scope", "Context", "Required persistent memory scope.", [
            "project",
            "user",
          ]),
          text(
            "path",
            "Context",
            "Required relative path within agent-memory; no traversal or drive roots.",
          ),
        ],
        true,
      ),
      bool(
        "async",
        "Execution",
        "Default single-agent background/foreground launch.",
      ),
      integer(
        "timeoutMs",
        "Execution",
        "Positive integer runtime deadline in milliseconds.",
      ),
      integer(
        "toolTimeoutMs",
        "Execution",
        "Positive per-tool deadline, at most 2147483647 ms.",
      ),
      text(
        "machine",
        "Execution",
        "Herdr saved-machine label/id, not a raw SSH target.",
      ),
      text(
        "launcher",
        "Execution",
        "User-configured launcher name, 1-128 identifier characters; local Pi background only.",
      ),
      bool(
        "interactive",
        "Execution",
        "Parsed for compatibility, not currently enforced.",
        true,
      ),
      integer(
        "maxSubagentDepth",
        "Delegation",
        "Non-negative integer narrowing descendant depth.",
        true,
      ),
      bool(
        "allowNestedSubagents",
        "Delegation",
        "Authorize child-safe nesting; inherited ceilings remain authoritative.",
      ),
      csv(
        "allowedAgents",
        "Delegation",
        "Canonical case-sensitive allowlist. Narrows a separate grant; empty denies all descendants.",
      ),
      field(
        "acceptance",
        "Acceptance",
        "Scalar level, deprecated false disable shorthand, or structured acceptance policy.",
        ["string", "boolean", "map"],
        { choices: levels, children: acceptanceFields },
      ),
      enumeration(
        "acceptanceRole",
        "Acceptance",
        "Role for acceptance inference, not a tool grant.",
        ["read-only", "writer"],
        true,
      ),
      text("output", "Output", "Default single-agent output file.", true),
      enumeration("outputMode", "Output", "Inline or file-only output.", [
        "inline",
        "file-only",
      ]),
      field(
        "outputSchema",
        "Output",
        "Arbitrary JSON Schema keywords describing the requested structured result.",
        ["map", "null"],
        { openMap: true },
      ),
      csv("defaultReads", "Output", "Files to read before running."),
      bool("defaultProgress", "Output", "Maintain progress.md.", true),
      map(
        "toolBudget",
        "Tools",
        "Runtime tool budget; hard required, soft cannot exceed hard.",
        [
          integer("hard", "Tools", "Required positive integer hard limit."),
          integer(
            "soft",
            "Tools",
            "Optional positive integer soft limit, at most hard.",
          ),
          field(
            "block",
            "Tools",
            "Wildcard * or a non-empty list of tool names.",
            ["string", "list"],
            { choices: ["*"] },
          ),
        ],
        true,
      ),
      arbitrary(
        "permissions",
        "Tools",
        "Arbitrary tool-name rules (allow/ask/deny); no bash or internal coordination tools.",
      ),
      arbitrary(
        "permission",
        "Tools",
        "Alias for permissions; declaring both is invalid.",
      ),
      map(
        "runner",
        "Runner",
        "Native Pi, external-cli, or external-job runner. Controls are type-specific.",
        runnerFields,
        true,
      ),
    ],
  },
};

function isRecord(value: unknown): value is AgentFrontmatter {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function valueKind(value: AgentValue): AgentValueKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "list";
  if (typeof value === "object") return "map";
  if (typeof value === "number") return "integer";
  return typeof value as "string" | "boolean";
}

// Reject non-data objects, undefined, non-finite numbers and recursive aliases.
// Do this before field validation so arbitrary provider options remain safe too.
function dataErrors(
  value: unknown,
  path: string,
  ancestors = new Set<object>(),
): string[] {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return [];
  if (typeof value === "number")
    return Number.isFinite(value) ? [] : [`${path}: number must be finite.`];
  if (!Array.isArray(value) && !isRecord(value))
    return [`${path}: expected a YAML/JSON data value.`];
  if (ancestors.has(value))
    return [`${path}: cyclic values/aliases cannot be authored.`];
  ancestors.add(value);
  const errors = Object.entries(value).flatMap(([key, child]) =>
    dataErrors(child, `${path}.${key}`, ancestors),
  );
  ancestors.delete(value);
  return errors;
}

function validateFields(
  fields: readonly AgentFieldDefinition[],
  record: AgentFrontmatter,
  prefix = "",
): string[] {
  const errors: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const definition = fields.find((candidate) => candidate.key === key);
    if (!definition) {
      errors.push(
        `${path}: unknown frontmatter key; structured editing is refused to avoid losing unsupported controls.`,
      );
      continue;
    }
    const kind = valueKind(value);
    if (!definition.kinds.includes(kind)) {
      errors.push(
        `${path}: expected ${definition.kinds.join(" or ")}, got ${kind}.`,
      );
      continue;
    }
    if (kind === "integer" && !Number.isSafeInteger(value))
      errors.push(`${path}: expected a safe integer.`);
    if (
      typeof value === "string" &&
      definition.choices &&
      !definition.choices.includes(value)
    ) {
      errors.push(`${path}: must be one of ${definition.choices.join(", ")}.`);
    }
    if (isRecord(value) && definition.children && !definition.openMap) {
      errors.push(...validateFields(definition.children, value, path));
    }
    if (Array.isArray(value)) {
      for (const [index, item] of value.entries()) {
        const itemPath = `${path}[${index}]`;
        if (definition.children && isRecord(item))
          errors.push(...validateFields(definition.children, item, itemPath));
        else if (
          typeof item !== "string" ||
          (key === "verify" && definition.children)
        ) {
          errors.push(
            `${itemPath}: expected ${key === "verify" ? "a command map" : definition.children ? "a string or map" : "a string"}.`,
          );
        } else if (
          key !== "block" &&
          definition.choices &&
          !definition.choices.includes(item)
        ) {
          errors.push(
            `${itemPath}: must be one of ${definition.choices.join(", ")}.`,
          );
        }
      }
    }
  }
  return errors;
}

function entries(value: AgentValue | undefined): string[] {
  return typeof value === "string"
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
}
function nonempty(value: AgentValue | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function positive(
  value: AgentValue | undefined,
  path: string,
  errors: string[],
  maximum?: number,
): void {
  if (value === undefined) return;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    (maximum !== undefined && value > maximum)
  ) {
    errors.push(
      `${path}: must be a positive integer${maximum === undefined ? "" : ` no larger than ${maximum}`}.`,
    );
  }
}
function requireText(
  value: AgentValue | undefined,
  path: string,
  errors: string[],
): void {
  if (!nonempty(value)) errors.push(`${path}: a non-empty string is required.`);
}
function falseOnly(
  value: AgentValue | undefined,
  path: string,
  errors: string[],
): void {
  if (typeof value === "boolean" && value !== false)
    errors.push(
      `${path}: only false is accepted; omit to use native defaults.`,
    );
}

function validateAcceptance(
  value: AgentValue | undefined,
  fm: AgentFrontmatter,
  errors: string[],
): void {
  if (typeof value === "boolean") falseOnly(value, "acceptance", errors);
  if (value === "none")
    errors.push(
      "acceptance: level none requires a map with a non-empty reason.",
    );
  if (value === "verified")
    errors.push(
      "acceptance: verified requires a map with at least one runtime verify command.",
    );
  if (!isRecord(value)) return;
  if (value.level === "none")
    requireText(value.reason, "acceptance.reason", errors);
  if (
    value.level === "verified" &&
    (!Array.isArray(value.verify) || value.verify.length === 0)
  ) {
    errors.push(
      "acceptance.verify: verified requires at least one runtime command.",
    );
  }
  if (value.preserveStagedIndex !== undefined) {
    if (value.preserveStagedIndex !== true)
      errors.push(
        "acceptance.preserveStagedIndex: must be true when provided.",
      );
    if (value.level !== "checked" && value.level !== "verified")
      errors.push(
        "acceptance.preserveStagedIndex: requires level checked or verified.",
      );
  }
  if (value.report !== undefined && !isRecord(fm.outputSchema))
    errors.push("acceptance.report: requires outputSchema.");
  const ids = new Set<string>();
  if (Array.isArray(value.criteria))
    for (const [index, criterion] of value.criteria.entries()) {
      if (!isRecord(criterion)) continue;
      const path = `acceptance.criteria[${index}]`;
      requireText(criterion.id, `${path}.id`, errors);
      requireText(criterion.must, `${path}.must`, errors);
      if (typeof criterion.id === "string") {
        const id = criterion.id
          .trim()
          .toLowerCase()
          .replace(/[\s_]+/g, "-")
          .replace(/-+/g, "-");
        if (ids.has(id))
          errors.push(
            `${path}.id: duplicate normalized criterion id ${JSON.stringify(id)}.`,
          );
        ids.add(id);
      }
    }
  if (Array.isArray(value.verify))
    for (const [index, command] of value.verify.entries()) {
      if (!isRecord(command)) continue;
      const path = `acceptance.verify[${index}]`;
      requireText(command.id, `${path}.id`, errors);
      requireText(command.command, `${path}.command`, errors);
      positive(command.timeoutMs, `${path}.timeoutMs`, errors);
      if (isRecord(command.env))
        for (const [key, env] of Object.entries(command.env)) {
          if (typeof env !== "string")
            errors.push(`${path}.env.${key}: expected a string.`);
        }
      if (command.schema !== undefined && command.output !== "json")
        errors.push(`${path}.schema: requires output: json.`);
      if (
        command.output === "json" &&
        fm.outputSchema !== undefined &&
        fm.outputSchema !== null
      ) {
        errors.push(
          `${path}.output: typed verification cannot be combined with outputSchema (two structured-output sources).`,
        );
      }
    }
  falseOnly(value.review, "acceptance.review", errors);
}

function normalizedPackage(value: AgentValue | undefined): string {
  return typeof value === "string"
    ? value
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9.-]/g, "")
        .replace(/-+/g, "-")
        .replace(/\.+/g, ".")
        .replace(/(?:^[-.]+|[-.]+$)/g, "")
    : "";
}

function validateNico(fm: AgentFrontmatter, errors: string[]): void {
  requireText(fm.name, "name", errors);
  requireText(fm.description, "description", errors);
  falseOnly(fm.package, "package", errors);
  if (
    nonempty(fm.package) &&
    !/^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/.test(
      normalizedPackage(fm.package),
    )
  ) {
    errors.push(
      "package: invalid after namespace sanitization; use a dotted/hyphenated identifier.",
    );
  }
  falseOnly(fm.thinking, "thinking", errors);
  positive(fm.timeoutMs, "timeoutMs", errors);
  positive(fm.toolTimeoutMs, "toolTimeoutMs", errors, 2_147_483_647);
  if (typeof fm.maxSubagentDepth === "number" && fm.maxSubagentDepth < 0)
    errors.push("maxSubagentDepth: must be non-negative.");
  if (isRecord(fm.memory)) {
    if (fm.memory.scope === undefined)
      errors.push("memory.scope: project or user is required.");
    requireText(fm.memory.path, "memory.path", errors);
    if (
      typeof fm.memory.path === "string" &&
      (/^(?:[A-Za-z]:|[/\\])/.test(fm.memory.path) ||
        fm.memory.path.includes("\0") ||
        fm.memory.path
          .split(/[/\\]/)
          .some(
            (part) =>
              part.trim() === "." || part.trim() === ".." || part.includes(":"),
          ))
    ) {
      errors.push(
        "memory.path: must remain relative within agent-memory, without . / .. traversal, drive roots, colons or NUL.",
      );
    }
  }
  if (fm.permission !== undefined && fm.permissions !== undefined)
    errors.push("permissions: cannot declare both permission and permissions.");
  for (const key of ["permission", "permissions"])
    if (isRecord(fm[key])) {
      for (const [tool, decision] of Object.entries(fm[key])) {
        if (
          !tool.trim() ||
          [
            "bash",
            "contact_supervisor",
            "intercom",
            "bg_wait",
            "structured_output",
          ].includes(tool)
        ) {
          errors.push(
            `${key}.${tool}: reserved/unsupported tool; bash policy belongs to pi-guard.`,
          );
        }
        if (decision !== "allow" && decision !== "ask" && decision !== "deny")
          errors.push(`${key}.${tool}: must be allow, ask or deny.`);
      }
    }
  if (isRecord(fm.toolBudget)) {
    const budget = fm.toolBudget;
    if (budget.hard === undefined)
      errors.push("toolBudget.hard: a positive integer is required.");
    positive(budget.hard, "toolBudget.hard", errors);
    positive(budget.soft, "toolBudget.soft", errors);
    if (
      typeof budget.soft === "number" &&
      typeof budget.hard === "number" &&
      budget.soft > budget.hard
    )
      errors.push("toolBudget.soft: must be <= toolBudget.hard.");
    if (
      Array.isArray(budget.block) &&
      (budget.block.length === 0 ||
        budget.block.some((item) => !nonempty(item)))
    )
      errors.push(
        "toolBudget.block: requires at least one non-empty tool name.",
      );
  }
  validateAcceptance(fm.acceptance, fm, errors);
  if (fm.machine !== undefined) {
    requireText(fm.machine, "machine", errors);
    if (
      typeof fm.machine === "string" &&
      (fm.machine.trim().length > 128 ||
        /[\u0000-\u001f\u007f]/u.test(fm.machine))
    )
      errors.push(
        "machine: use at most 128 characters without control characters.",
      );
  }
  if (
    fm.launcher !== undefined &&
    (typeof fm.launcher !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(fm.launcher))
  )
    errors.push(
      "launcher: must start with a letter/digit and use only letters, digits, '.', '_' or '-' (at most 128 characters).",
    );
  const runner = isRecord(fm.runner) ? fm.runner : undefined;
  if (runner) {
    if (runner.type === undefined)
      errors.push("runner.type: pi, external-cli or external-job is required.");
    const allowed =
      runner.type === "pi"
        ? ["type"]
        : runner.type === "external-job"
          ? ["type", "provider", "options"]
          : [
              "type",
              "command",
              "args",
              "adapter",
              "promptDelivery",
              "capabilities",
            ];
    for (const key of Object.keys(runner))
      if (!allowed.includes(key))
        errors.push(
          `runner.${key}: not supported for runner.type ${String(runner.type)}.`,
        );
    if (runner.type === "external-job") {
      requireText(runner.provider, "runner.provider", errors);
      if (
        typeof runner.provider === "string" &&
        runner.provider !== runner.provider.trim()
      )
        errors.push("runner.provider: must be trimmed.");
    }
    if (runner.type === "external-cli") {
      requireText(runner.command, "runner.command", errors);
      if (
        runner.adapter !== undefined &&
        Array.isArray(runner.args) &&
        runner.args.length
      )
        errors.push(
          "runner.args: code-owned adapters own argv; remove arguments.",
        );
      if (isRecord(runner.capabilities))
        for (const [key, value] of Object.entries(runner.capabilities)) {
          if (value !== false)
            errors.push(
              `runner.capabilities.${key}: only false is accepted; adapters cannot be widened.`,
            );
        }
    }
  }
  if (
    fm.launcher !== undefined &&
    (fm.machine !== undefined || (runner && runner.type !== "pi"))
  )
    errors.push(
      "launcher: local Pi background only; cannot combine with machine or external runners.",
    );
  if (runner?.type === "external-cli" || runner?.type === "external-job") {
    const claude =
      runner.type === "external-cli" &&
      (runner.adapter === "claude-code" ||
        runner.adapter === "claude-code-writer");
    for (const key of [
      "tools",
      "excludeTools",
      "allowNestedSubagents",
      "allowedAgents",
      "model",
      "thinking",
      "extensions",
      "subagentOnlyExtensions",
      "mutationTools",
      "maxSubagentDepth",
      "skills",
      "skill",
      "skillPath",
      "toolBudget",
      "permission",
      "permissions",
    ]) {
      if (
        Object.hasOwn(fm, key) &&
        !(claude && (key === "model" || key === "thinking"))
      )
        errors.push(
          `${key}: unsupported Pi-only field with ${runner.type}; remove it or use runner.type: pi.`,
        );
    }
  }
  const selections = [
    typeof fm.name === "string" ? fm.name : "",
    ...entries(fm.aliases ?? fm.alias),
  ];
  for (const reserved of ["codex-exec", "claude-code", "cursor-agent"]) {
    if (
      selections.includes(reserved) &&
      !(runner?.type === "external-cli" && runner.adapter === reserved)
    )
      errors.push(
        `name/aliases: ${reserved} is reserved for its read-only adapter; use ${reserved}-writer for explicit writes.`,
      );
  }
}

export function validateAgentFrontmatter(
  runtime: AgentRuntime,
  frontmatter: AgentFrontmatter,
): string[] {
  if (!Object.hasOwn(AGENT_PROFILES, runtime))
    return ["runtime: expected tintin or nico."];
  if (!isRecord(frontmatter))
    return ["frontmatter: expected a mapping of field names to values."];
  const errors = dataErrors(frontmatter, "frontmatter");
  if (errors.length) return errors;
  errors.push(...validateFields(AGENT_PROFILES[runtime].fields, frontmatter));
  if (runtime === "nico") validateNico(frontmatter, errors);
  else {
    if (typeof frontmatter.name === "string" && frontmatter.name.includes(":"))
      errors.push(
        "name: ':' is reserved for plugin-scoped identifiers; use display_name for a cosmetic label.",
      );
    if (typeof frontmatter.max_turns === "number" && frontmatter.max_turns < 0)
      errors.push("max_turns: must be non-negative; 0 means unlimited.");
    falseOnly(frontmatter.isolation, "isolation", errors);
    const nesting =
      frontmatter.allowed_subagents === true ||
      entries(frontmatter.allowed_subagents).some(
        (entry) => entry.toLowerCase() !== "none",
      );
    if (frontmatter.isolated === true && nesting)
      errors.push(
        "allowed_subagents: isolated agents cannot receive nested tools; remove the grant or disable isolated.",
      );
    for (const name of entries(frontmatter.exclude_extensions))
      if (name === "*" || /[/\\]/.test(name))
        errors.push(
          "exclude_extensions: plain extension names only, without paths or '*'; exclusion wins over selectors.",
        );
  }
  return errors;
}

function assertFrontmatter(
  runtime: AgentRuntime,
  frontmatter: AgentFrontmatter,
): void {
  const errors = validateAgentFrontmatter(runtime, frontmatter);
  if (errors.length)
    throw new Error(
      `Invalid ${AGENT_PROFILES[runtime].label} agent frontmatter:\n- ${errors.join("\n- ")}`,
    );
}

// Convert maps explicitly: YAML complex/numeric keys and aliases must not silently
// stringify into field names. Object.fromEntries safely retains __proto__ as data.
function yamlValue(
  value: unknown,
  path: string,
  ancestors = new Set<object>(),
): AgentValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!(value instanceof Map) && !Array.isArray(value))
    throw new Error(
      `${path}: expected finite YAML data (strings, numbers, booleans, null, lists or maps).`,
    );
  if (ancestors.has(value))
    throw new Error(`${path}: cyclic YAML aliases are not supported.`);
  ancestors.add(value);
  const result: AgentValue = Array.isArray(value)
    ? value.map((child, index) =>
        yamlValue(child, `${path}[${index}]`, ancestors),
      )
    : Object.fromEntries(
        [...value.entries()].map(([key, child]) => {
          if (typeof key !== "string")
            throw new Error(`${path}: YAML mapping keys must be strings.`);
          return [key, yamlValue(child, `${path}.${key}`, ancestors)];
        }),
      );
  ancestors.delete(value);
  return result;
}

export function parseAgentMarkdown(
  runtime: AgentRuntime,
  markdown: string,
): { frontmatter: AgentFrontmatter; body: string } {
  const opening = /^(?:\uFEFF)?---[\t ]*\r?\n/.exec(markdown);
  if (!opening) {
    const frontmatter: AgentFrontmatter = {};
    assertFrontmatter(runtime, frontmatter);
    return { frontmatter, body: markdown };
  }
  const start = opening[0].length;
  const remainder = markdown.slice(start);
  const closing = /^---[\t ]*(?:\r?\n|$)/m.exec(remainder);
  if (!closing)
    throw new Error("Agent frontmatter: missing closing --- fence.");
  const source = remainder.slice(0, closing.index);
  const document = parseDocument(source, {
    version: "1.2",
    uniqueKeys: true,
    strict: true,
  });
  if (document.errors.length || document.warnings.length) {
    throw new Error(
      `Agent frontmatter YAML: ${[...document.errors, ...document.warnings].map((error) => error.message).join("\n")}`,
    );
  }
  if (document.contents !== null && !isMap(document.contents))
    throw new Error(
      "Agent frontmatter YAML: expected a mapping, not a scalar or list.",
    );
  // An entirely empty frontmatter block is an empty mapping, not a null value.
  const parsed =
    document.contents === null
      ? {}
      : yamlValue(
          document.toJS({ mapAsMap: true, maxAliasCount: 100 }),
          "frontmatter",
        );
  if (!isRecord(parsed))
    throw new Error("Agent frontmatter YAML: expected a mapping.");
  assertFrontmatter(runtime, parsed);
  return {
    frontmatter: parsed,
    body: remainder.slice(closing.index + closing[0].length),
  };
}

export function renderAgentMarkdown(
  runtime: AgentRuntime,
  frontmatter: AgentFrontmatter,
  body: string,
): string {
  assertFrontmatter(runtime, frontmatter);
  // Nico's loader reads flat fields as strings, not YAML. A top-level [] is
  // treated as a literal selector, while structured JSON fields are parsed
  // with JSON.parse; never silently save a different runtime configuration.
  if (runtime === "nico") {
    for (const [key, value] of Object.entries(frontmatter)) {
      if (Array.isArray(value) && value.length === 0)
        throw new Error(
          `${key}: Nico reads an empty YAML list as the literal selector "[]"; omit the field or use empty text.`,
        );
    }
  }
  // Quote ordinary strings, not booleans/null/numbers. In particular on,
  // true, #hex and multiline strings retain their types on YAML roundtrip.
  const options = {
    defaultStringType: "QUOTE_DOUBLE" as const,
    defaultKeyType: "PLAIN" as const,
    blockQuote: false,
    lineWidth: 0,
    aliasDuplicateObjects: false,
  };
  const header = Object.entries(frontmatter)
    .map(([key, value]) => {
      if (runtime === "nico" && Array.isArray(value)) {
        const items = value.map((item) => {
          const plain =
            typeof item === "string"
              ? stringify(item, {
                  ...options,
                  defaultStringType: "PLAIN",
                }).trimEnd()
              : "";
          if (
            !plain ||
            plain !== item ||
            plain.includes(",") ||
            plain.includes("\n")
          )
            throw new Error(
              `${key}: Nico list items must be plain, comma-free strings; use comma-separated text or omit this field.`,
            );
          return `  - ${plain}\n`;
        });
        return `${key}:\n${items.join("")}`;
      }
      if (
        runtime === "nico" &&
        (key === "toolBudget" || key === "outputSchema") &&
        isRecord(value)
      )
        return `${key}: ${JSON.stringify(value)}\n`;
      return stringify({ [key]: value }, options);
    })
    .join("");
  return `---\n${header}---\n${body}`;
}

export function agentIdentity(
  runtime: AgentRuntime,
  frontmatter: AgentFrontmatter,
  filename: string,
): string {
  assertFrontmatter(runtime, frontmatter);
  const fallback =
    filename.split(/[/\\]/).pop()?.replace(/\.md$/i, "") ?? filename;
  const name =
    typeof frontmatter.name === "string" && frontmatter.name.trim()
      ? frontmatter.name.trim()
      : fallback;
  const namespace =
    runtime === "nico" ? normalizedPackage(frontmatter.package) : "";
  return namespace ? `${namespace}.${name}` : name;
}
