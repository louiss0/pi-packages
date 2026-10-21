import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  ConfirmationBox,
  createExternalEditorFactory,
  Form,
  LabelledInput,
  MultiSelect,
  Picker,
} from "@code-fixer-23/pi-form-components";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  McpExposure,
  McpServerConfig,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import {
  array,
  boolean,
  check,
  maxLength,
  minLength,
  minValue,
  number,
  object,
  optional,
  picklist,
  pipe,
  record,
  regex,
  safeParse,
  string,
  summarize,
  unknown,
  type InferOutput,
} from "valibot";

import {
  getErrorMessage,
  isNotFoundError,
  isRecord,
  parseJson,
} from "../shared/json";
import { NodeFileSystem, type ResourceFileSystem } from "../shared/filesystem";
import { parseObjectErrors } from "../shared/parse";
import { notifyWhenUsingDevelopmentExtension } from "../shared/runtime";
import { getFilterSubcommandArgumentCompletionFromStringUsingSubLabel } from "../shared/subcommands";
import { formOverlayOptions, modalEditorOverlayOptions } from "../shared/ui";

const extensionName = "mcp-craft";

const GLOBAL_COMMAND = "resource:mcp";
const LOCAL_COMMAND = "resource:local-mcp";
const EDIT_FLAG = "resource:mcp-craft-edit";

const PI_DIRECTORY_NAME = ".pi";
const AGENT_DIRECTORY_NAME = "agent";
const MCP_FILE_NAME = "mcp.json";

const STDIO_TRANSPORT = "stdio";
const HTTP_TRANSPORT = "http";

const subcommands = picklist(["create", "edit", "delete"] as const);
type Subcommand = (typeof subcommands.options)[number];

/**
 * The exposures Pi accepts, in the order the form offers them.
 *
 * Typed against Pi's own `McpExposure`, so an exposure Pi drops fails the build
 * here instead of producing a config Pi rejects.
 */
const EXPOSURES = [
  "codemode",
  "deferred",
  "direct",
  "hidden",
] as const satisfies readonly McpExposure[];

const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/** A quoted run, so an argument with spaces stays one argument. */
const ARGUMENT_PATTERN = /"[^"]*"|'[^']*'|[^\s"']+/g;
const QUOTED_ARGUMENT_PATTERN = /^(["'])(.*)\1$/;

export type McpScope = "global" | "local";
export type McpTransport = typeof STDIO_TRANSPORT | typeof HTTP_TRANSPORT;
export type McpFilePathResolver = (scope: McpScope) => string;

/** Pi's own config types, narrowed so a form can read the fields of one transport. */
type McpStdioConfig = Extract<McpServerConfig, { command: string }>;
type McpHttpConfig = Extract<McpServerConfig, { url: string }>;
type McpOAuthConfig = NonNullable<McpHttpConfig["oauth"]>;
type FilledValues<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
};

export interface McpFileContents {
  /** Other top level keys of the file, kept so a write never drops them. */
  file: Record<string, unknown>;
  /** Every entry as written, so an edit or delete never drops what it cannot parse. */
  serverConfigs: Record<string, unknown>;
  /** Only the entries pi would accept. */
  servers: Record<string, McpServerConfig>;
  /** One message per entry pi would reject. */
  errors: string[];
  /** Set when the file itself could not be read as an MCP config. */
  fileError?: string;
}

export interface McpCraftDeps {
  fileSystem: ResourceFileSystem;
  getMcpFilePath: McpFilePathResolver;
  openExternalEditor: (filePath: string) => Promise<Error | undefined>;
}

export type McpServerEntryResult =
  | { success: true; config: McpServerConfig }
  | { success: false; error: string };

const sharedServerFields = {
  exposure: optional(picklist(EXPOSURES)),
  toolExposure: optional(record(string(), picklist(EXPOSURES))),
  enabled: optional(boolean()),
  timeout: optional(
    pipe(number(), minValue(1, "Timeout must be a positive number of seconds")),
  ),
};

const stdioServerSchema = object({
  type: optional(picklist([STDIO_TRANSPORT])),
  command: pipe(string(), minLength(1, "Command is required")),
  args: optional(array(string())),
  env: optional(record(string(), string())),
  cwd: optional(string()),
  ...sharedServerFields,
});

const oauthServerSchema = object({
  clientId: optional(string()),
  clientSecret: optional(string()),
  callbackPort: optional(
    pipe(number(), minValue(1, "Callback port must be a positive number")),
  ),
  callbackUrl: optional(string()),
  scope: optional(string()),
});

const httpServerSchema = object({
  type: optional(picklist([HTTP_TRANSPORT, "streamable-http"])),
  url: pipe(
    string(),
    minLength(1, "URL is required"),
    check(isHttpUrl, "URL must be an http or https URL"),
  ),
  headers: optional(record(string(), string())),
  oauth: optional(oauthServerSchema),
  ...sharedServerFields,
});

const mcpFileSchema = object({
  mcpServers: record(string(), unknown()),
});

export function createMcpFilePathResolver({
  cwd,
  homePath = homedir(),
}: {
  cwd: string;
  homePath?: string;
}): McpFilePathResolver {
  return (scope) =>
    scope === "global"
      ? join(homePath, PI_DIRECTORY_NAME, AGENT_DIRECTORY_NAME, MCP_FILE_NAME)
      : join(cwd, PI_DIRECTORY_NAME, MCP_FILE_NAME);
}

/**
 * Validate one entry of an `mcpServers` object with pi's own rules, so the extension never
 * writes a server pi would skip. The transport is written back explicitly, which keeps a
 * hand written entry readable after the first edit.
 */
export function parseMcpServerConfig(
  name: string,
  value: unknown,
): McpServerEntryResult {
  if (!MCP_SERVER_NAME_PATTERN.test(name)) {
    return {
      success: false,
      error: `invalid server name "${name}" (use letters, digits, "_" and "-")`,
    };
  }

  if (!isRecord(value)) {
    return { success: false, error: `server "${name}" must be an object` };
  }

  if (value.type === "sse") {
    return {
      success: false,
      error: `server "${name}": legacy SSE transport is not supported; use the streamable HTTP URL`,
    };
  }

  if (typeof value.url !== "string" && typeof value.command !== "string") {
    return {
      success: false,
      error: `server "${name}" needs either "command" (stdio) or "url" (streamable HTTP)`,
    };
  }

  const result = safeParse(
    "url" in value ? httpServerSchema : stdioServerSchema,
    value,
  );

  if (!result.success) {
    return {
      success: false,
      error: `server "${name}": ${summarize(result.issues)}`,
    };
  }

  // The schema was picked from the entry's own shape, so the output is that transport's.
  if ("url" in result.output) {
    return {
      success: true,
      config: { ...result.output, type: HTTP_TRANSPORT },
    };
  }

  return { success: true, config: { ...result.output, type: STDIO_TRANSPORT } };
}

export async function readMcpFile(
  fileSystem: ResourceFileSystem,
  getMcpFilePath: McpFilePathResolver,
  scope: McpScope,
): Promise<McpFileContents> {
  const result = await fileSystem.readFile(getMcpFilePath(scope));

  if (!result.success) {
    // A file that cannot be read is not an empty config, so it must stop the change.
    if (!isNotFoundError(result.error)) {
      return {
        file: {},
        serverConfigs: {},
        servers: {},
        errors: [],
        fileError: `Could not read ${MCP_FILE_NAME}: ${getErrorMessage(result.error)}`,
      };
    }

    return { file: {}, serverConfigs: {}, servers: {}, errors: [] };
  }

  const parsed = parseMcpFile(result.data);

  return {
    file: parsed.file,
    serverConfigs: parsed.serverConfigs,
    servers: collectAcceptedServers(parsed.serverConfigs),
    errors: collectServerErrors(parsed.serverConfigs),
    fileError: parsed.fileError,
  };
}

/** Write the servers back, keeping every other key the file already had. */
export async function writeMcpFile(
  fileSystem: ResourceFileSystem,
  getMcpFilePath: McpFilePathResolver,
  scope: McpScope,
  serverConfigs: Record<string, unknown>,
) {
  const filePath = getMcpFilePath(scope);
  const directoryResult = await fileSystem.mkdir(dirname(filePath), {
    recursive: true,
  });

  if (!directoryResult.success) {
    return directoryResult;
  }

  const existingResult = await fileSystem.readFile(filePath);

  // Only a file that is not there yet starts empty; any other read failure stops the write.
  if (!existingResult.success && !isNotFoundError(existingResult.error)) {
    return existingResult;
  }

  const existingFile = existingResult.success
    ? parseMcpFile(existingResult.data).file
    : {};

  return fileSystem.writeFile(
    filePath,
    renderMcpFile({ ...existingFile, mcpServers: serverConfigs }),
  );
}

const serverNameField = pipe(
  string(),
  check((value) => value.trim().length > 0, "Name is required"),
  maxLength(64, "Name must be 64 characters or fewer"),
  regex(
    MCP_SERVER_NAME_PATTERN,
    'Name must be letters, digits, "_" and "-" only',
  ),
);

const commandField = pipe(
  string(),
  check((value) => value.trim().length > 0, "Command is required"),
);

const urlField = pipe(
  string(),
  check((value) => value.trim().length > 0, "URL is required"),
  check(isHttpUrl, "URL must be an http or https URL"),
);

const exposureField = optional(
  pipe(
    string(),
    check(
      (value) => value === "" || isExposure(value),
      `Exposure must be empty or one of ${EXPOSURES.join(", ")}`,
    ),
  ),
  "",
);

const timeoutField = optional(
  pipe(
    string(),
    check(
      isPositiveIntegerOrEmpty,
      "Timeout must be a positive number of seconds",
    ),
  ),
  "",
);

const argsField = optional(
  pipe(
    string(),
    check(
      isArgsList,
      "Args must be space separated, with quotes around an argument that has spaces",
    ),
  ),
  "",
);

const StdioServerRequiredFieldsSchema = object({
  name: serverNameField,
  command: commandField,
  optionalFields: boolean(),
});

const StdioServerOptionalFieldsSchema = object({
  args: argsField,
  env: optional(
    pipe(
      string(),
      check(
        (value) => isKeyValueList(value, ENV_NAME_PATTERN),
        "Env must be KEY=VALUE pairs separated by commas",
      ),
    ),
    "",
  ),
  cwd: optional(string(), ""),
  exposure: exposureField,
  timeout: timeoutField,
});

const HttpServerRequiredFieldsSchema = object({
  name: serverNameField,
  url: urlField,
  optionalFields: boolean(),
  oauthFields: boolean(),
});

const HttpServerOptionalFieldsSchema = object({
  headers: optional(
    pipe(
      string(),
      check(
        (value) => isKeyValueList(value, HEADER_NAME_PATTERN),
        "Headers must be Name=Value pairs separated by commas",
      ),
    ),
    "",
  ),
  exposure: exposureField,
  timeout: timeoutField,
});

const OAuthFormSchema = object({
  clientId: optional(string(), ""),
  clientSecret: optional(string(), ""),
  scope: optional(string(), ""),
  callbackPort: optional(
    pipe(
      string(),
      check(
        isPositiveIntegerOrEmpty,
        "Callback port must be a positive number",
      ),
    ),
    "",
  ),
  callbackUrl: optional(
    pipe(
      string(),
      check(
        (value) => value === "" || isLoopbackHttpUrl(value),
        "Callback URL must be empty or an http URL on localhost, 127.0.0.1 or [::1]",
      ),
    ),
    "",
  ),
});

export type StdioServerRequiredFields = InferOutput<
  typeof StdioServerRequiredFieldsSchema
>;
export type StdioServerOptionalFields = InferOutput<
  typeof StdioServerOptionalFieldsSchema
>;
export type HttpServerRequiredFields = InferOutput<
  typeof HttpServerRequiredFieldsSchema
>;
export type HttpServerOptionalFields = InferOutput<
  typeof HttpServerOptionalFieldsSchema
>;
export type OAuthFields = InferOutput<typeof OAuthFormSchema>;

/**
 * The keys a form can write, taken from the form schemas so a field added to a form is
 * never also dropped on edit. Anything else, such as a hand written `toolExposure` or an
 * `oauth` block the form was not asked about, is carried over untouched.
 */
const FORM_MANAGED_SERVER_FIELDS = new Set([
  ...Object.keys(StdioServerRequiredFieldsSchema.entries),
  ...Object.keys(StdioServerOptionalFieldsSchema.entries),
  ...Object.keys(HttpServerRequiredFieldsSchema.entries),
  ...Object.keys(HttpServerOptionalFieldsSchema.entries),
  "type",
]);

export function parseStdioServerFormValues(values: StdioServerRequiredFields) {
  return parseObjectErrors(StdioServerRequiredFieldsSchema, values);
}

export function parseStdioServerOptionalFormValues(
  values: StdioServerOptionalFields,
) {
  return parseObjectErrors(StdioServerOptionalFieldsSchema, values);
}

export function parseHttpServerFormValues(values: HttpServerRequiredFields) {
  return parseObjectErrors(HttpServerRequiredFieldsSchema, values);
}

export function parseHttpServerOptionalFormValues(
  values: HttpServerOptionalFields,
) {
  return parseObjectErrors(HttpServerOptionalFieldsSchema, values);
}

export function parseOAuthFormValues(values: OAuthFields) {
  return parseObjectErrors(OAuthFormSchema, values);
}

export function renderStdioServerConfig(
  required: StdioServerRequiredFields,
  optional: StdioServerOptionalFields,
): McpServerConfig {
  const config: McpStdioConfig = {
    type: STDIO_TRANSPORT,
    command: required.command.trim(),
    args: splitArguments(optional.args),
    env: parseKeyValueList(optional.env),
    cwd: optional.cwd.trim(),
    exposure: toExposure(optional.exposure),
    timeout: toOptionalNumber(optional.timeout),
  };

  return removeEmptyValues(config);
}

export function renderHttpServerConfig(
  required: HttpServerRequiredFields,
  optional: HttpServerOptionalFields,
  oauth?: OAuthFields,
): McpServerConfig {
  const config: McpHttpConfig = {
    type: HTTP_TRANSPORT,
    url: required.url.trim(),
    headers: parseKeyValueList(optional.headers),
    oauth: oauth ? renderOAuthConfig(oauth) : undefined,
    exposure: toExposure(optional.exposure),
    timeout: toOptionalNumber(optional.timeout),
  };

  return removeEmptyValues(config);
}

export function createStdioServerForm(
  tui: TUI,
  theme: Theme,
  done: (value: StdioServerRequiredFields | null) => void,
  initialValues: Partial<StdioServerRequiredFields> = {},
) {
  return new Form<StdioServerRequiredFields>(
    {
      title: "MCP Server (stdio)",
      fields: [
        new LabelledInput("name", theme, initialValues.name),
        new LabelledInput("command", theme, initialValues.command),
        new ConfirmationBox(
          "optionalFields",
          theme,
          "Do you want to fill in the optional fields?",
        ),
      ],
      parse: parseStdioServerFormValues,
      footer: [
        "* required | space toggles the checkbox",
        "Enter next/submit | Tab switch field | Esc cancel",
      ].join("\n"),
      spacing: 1,
    },
    tui,
    done,
  );
}

export function createStdioServerDetailsForm(
  tui: TUI,
  theme: Theme,
  done: (value: StdioServerOptionalFields | null) => void,
  initialValues: Partial<StdioServerOptionalFields> = {},
) {
  return new Form<StdioServerOptionalFields>(
    {
      title: "MCP Server (stdio) details",
      fields: [
        new LabelledInput("args", theme, initialValues.args),
        new LabelledInput("env", theme, initialValues.env),
        new LabelledInput("cwd", theme, initialValues.cwd),
        new LabelledInput("exposure", theme, initialValues.exposure),
        new LabelledInput("timeout", theme, initialValues.timeout),
      ],
      parse: parseStdioServerOptionalFormValues,
      footer: [
        "every field is optional | blank fields are left out of mcp.json",
        "args are space separated | quote an argument that has spaces",
        "env is KEY=VALUE pairs separated by commas and keeps ${VAR} and !command as written",
        `exposure: ${EXPOSURES.join(" | ")} | blank keeps pi's default of codemode`,
        "timeout is in seconds",
        "Enter next/submit | Tab switch field | Esc cancel",
      ].join("\n"),
      spacing: 1,
    },
    tui,
    done,
  );
}

export function createHttpServerForm(
  tui: TUI,
  theme: Theme,
  done: (value: HttpServerRequiredFields | null) => void,
  initialValues: Partial<HttpServerRequiredFields> = {},
) {
  return new Form<HttpServerRequiredFields>(
    {
      title: "MCP Server (http)",
      fields: [
        new LabelledInput("name", theme, initialValues.name),
        new LabelledInput("url", theme, initialValues.url),
        new ConfirmationBox(
          "optionalFields",
          theme,
          "Do you want to fill in the optional fields?",
        ),
        new ConfirmationBox(
          "oauthFields",
          theme,
          "Configure OAuth for this server?",
        ),
      ],
      parse: parseHttpServerFormValues,
      footer: [
        "* required | space toggles a checkbox",
        "Enter next/submit | Tab switch field | Esc cancel",
      ].join("\n"),
      spacing: 1,
    },
    tui,
    done,
  );
}

export function createHttpServerDetailsForm(
  tui: TUI,
  theme: Theme,
  done: (value: HttpServerOptionalFields | null) => void,
  initialValues: Partial<HttpServerOptionalFields> = {},
) {
  return new Form<HttpServerOptionalFields>(
    {
      title: "MCP Server (http) details",
      fields: [
        new LabelledInput("headers", theme, initialValues.headers),
        new LabelledInput("exposure", theme, initialValues.exposure),
        new LabelledInput("timeout", theme, initialValues.timeout),
      ],
      parse: parseHttpServerOptionalFormValues,
      footer: [
        "every field is optional | blank fields are left out of mcp.json",
        "headers are Name=Value pairs separated by commas and keep ${VAR} and !command as written",
        `exposure: ${EXPOSURES.join(" | ")} | blank keeps pi's default of codemode`,
        "timeout is in seconds",
        "Enter next/submit | Tab switch field | Esc cancel",
      ].join("\n"),
      spacing: 1,
    },
    tui,
    done,
  );
}

export function createOAuthForm(
  tui: TUI,
  theme: Theme,
  done: (value: OAuthFields | null) => void,
  initialValues: Partial<OAuthFields> = {},
) {
  return new Form<OAuthFields>(
    {
      title: "MCP Server OAuth",
      fields: [
        new LabelledInput("clientId", theme, initialValues.clientId),
        new LabelledInput("clientSecret", theme, initialValues.clientSecret),
        new LabelledInput("scope", theme, initialValues.scope),
        new LabelledInput("callbackPort", theme, initialValues.callbackPort),
        new LabelledInput("callbackUrl", theme, initialValues.callbackUrl),
      ],
      parse: parseOAuthFormValues,
      footer: [
        "Every field is optional | leave them blank to let pi register a client itself",
        "callbackUrl must be an http URL on localhost, 127.0.0.1 or [::1]",
        "Esc cancel leaves an existing oauth block untouched and stops the change",
      ].join("\n"),
      spacing: 1,
    },
    tui,
    done,
  );
}

export async function handleCreate(
  ctx: ExtensionCommandContext,
  scope: McpScope,
  deps: McpCraftDeps,
) {
  notifyWhenUsingDevelopmentExtension(extensionName, ctx);
  announceScope(ctx, scope, deps);

  const transport = await pickTransport(ctx);

  if (!transport) {
    ctx.ui.notify("MCP server creation cancelled", "info");
    return;
  }

  const pickedServer =
    transport === HTTP_TRANSPORT
      ? await pickHttpServer(ctx)
      : await pickStdioServer(ctx);

  if (!pickedServer) {
    ctx.ui.notify("MCP server creation cancelled", "info");
    return;
  }

  const contents = await readMcpFile(
    deps.fileSystem,
    deps.getMcpFilePath,
    scope,
  );

  if (reportFileError(ctx, contents)) {
    return;
  }

  if (pickedServer.name in contents.serverConfigs) {
    ctx.ui.notify(
      `MCP server '${pickedServer.name}' already exists in ${getScopeLabel(scope)}. Use edit to change it`,
      "error",
    );
    return;
  }

  const writeResult = await writeMcpFile(
    deps.fileSystem,
    deps.getMcpFilePath,
    scope,
    { ...contents.serverConfigs, [pickedServer.name]: pickedServer.config },
  );

  if (!writeResult.success) {
    ctx.ui.notify(
      `MCP server creation failed: ${writeResult.error.message}`,
      "error",
    );
    return;
  }

  ctx.ui.notify(
    `Added MCP server '${pickedServer.name}' to ${getScopeLabel(scope)}`,
  );
  await ctx.reload();
}

export async function handleEdit(
  ctx: ExtensionCommandContext,
  externalEdit: boolean,
  scope: McpScope,
  deps: McpCraftDeps,
) {
  notifyWhenUsingDevelopmentExtension(extensionName, ctx);
  announceScope(ctx, scope, deps);

  if (externalEdit) {
    await editMcpFileInExternalEditor(ctx, scope, deps);
    return;
  }

  const filePath = deps.getMcpFilePath(scope);
  const contents = await readMcpFile(
    deps.fileSystem,
    deps.getMcpFilePath,
    scope,
  );

  if (reportFileError(ctx, contents)) {
    return;
  }

  const serverName = await pickServerName(
    ctx,
    filePath,
    contents.serverConfigs,
  );

  if (!serverName) {
    return;
  }

  const serverConfig = contents.servers[serverName];

  if (!serverConfig) {
    ctx.ui.notify(`MCP server '${serverName}' is not valid`, "error");
    return;
  }

  const pickedServer =
    "url" in serverConfig
      ? await pickHttpServer(ctx, { name: serverName, config: serverConfig })
      : await pickStdioServer(ctx, { name: serverName, config: serverConfig });

  if (!pickedServer) {
    ctx.ui.notify("MCP server edit cancelled", "info");
    return;
  }

  const writeResult = await writeMcpFile(
    deps.fileSystem,
    deps.getMcpFilePath,
    scope,
    {
      ...contents.serverConfigs,
      [serverName]: preserveUnmanagedServerFields(
        contents.serverConfigs[serverName],
        pickedServer.config,
      ),
    },
  );

  if (!writeResult.success) {
    ctx.ui.notify(
      `MCP server edit failed: ${writeResult.error.message}`,
      "error",
    );
    return;
  }

  ctx.ui.notify(
    `Updated MCP server '${serverName}' in ${getScopeLabel(scope)}`,
  );
  await ctx.reload();
}

export async function handleDelete(
  ctx: ExtensionCommandContext,
  scope: McpScope,
  deps: McpCraftDeps,
) {
  notifyWhenUsingDevelopmentExtension(extensionName, ctx);
  announceScope(ctx, scope, deps);

  const filePath = deps.getMcpFilePath(scope);
  const contents = await readMcpFile(
    deps.fileSystem,
    deps.getMcpFilePath,
    scope,
  );

  if (reportFileError(ctx, contents)) {
    return;
  }

  const serverNames = Object.keys(contents.serverConfigs);

  if (serverNames.length === 0) {
    ctx.ui.notify(`No MCP servers found in ${filePath}`);
    return;
  }

  const selectedNames = await ctx.ui.custom<ReadonlyArray<string> | null>(
    (tui, theme, _keybindings, done) =>
      new MultiSelect(
        "Which MCP servers do you want to delete?",
        {
          items: serverNames.map((serverName) => ({
            value: serverName,
            label: serverName,
          })),
        },
        tui,
        theme,
        done,
      ),
    formOverlayOptions,
  );

  if (!selectedNames || selectedNames.length === 0) {
    return;
  }

  const writeResult = await writeMcpFile(
    deps.fileSystem,
    deps.getMcpFilePath,
    scope,
    Object.fromEntries(
      Object.entries(contents.serverConfigs).filter(
        ([serverName]) => !selectedNames.includes(serverName),
      ),
    ),
  );

  if (!writeResult.success) {
    ctx.ui.notify(
      `MCP server delete failed: ${writeResult.error.message}`,
      "error",
    );
    return;
  }

  ctx.ui.notify(
    `Removed ${selectedNames.length} MCP server(s) from ${getScopeLabel(scope)}`,
  );
  await ctx.reload();
}

async function editMcpFileInExternalEditor(
  ctx: ExtensionCommandContext,
  scope: McpScope,
  deps: McpCraftDeps,
) {
  const filePath = deps.getMcpFilePath(scope);
  const fileResult = await ensureMcpFileExists(deps.fileSystem, filePath);

  if (!fileResult.success) {
    ctx.ui.notify(
      `MCP file creation failed: ${fileResult.error.message}`,
      "error",
    );
    return;
  }

  const error = await deps.openExternalEditor(filePath);

  if (error) {
    ctx.ui.notify(error.message, "error");
    return;
  }

  ctx.ui.notify(`Edited ${filePath}. Reloading MCP servers...`);
  await ctx.reload();
}

async function ensureMcpFileExists(
  fileSystem: ResourceFileSystem,
  filePath: string,
) {
  const existingFile = await fileSystem.readFile(filePath);

  if (existingFile.success) {
    return { success: true as const };
  }

  if (!isNotFoundError(existingFile.error)) {
    return { success: false as const, error: existingFile.error };
  }

  const directoryResult = await fileSystem.mkdir(dirname(filePath), {
    recursive: true,
  });

  if (!directoryResult.success) {
    return { success: false as const, error: directoryResult.error };
  }

  return fileSystem.writeFile(filePath, renderMcpFile({ mcpServers: {} }));
}

async function pickTransport(ctx: ExtensionCommandContext) {
  return await ctx.ui.custom<McpTransport | null>(
    (tui, theme, _keybindings, done) =>
      new Picker<McpTransport>(
        "transport",
        {
          items: [STDIO_TRANSPORT, HTTP_TRANSPORT],
          itemLimit: 4,
          title: "How does this MCP server run?",
          helpText: "stdio runs a local command | http reaches a remote url",
        },
        theme,
        tui,
        done,
      ),
    formOverlayOptions,
  );
}

async function pickServerName(
  ctx: ExtensionCommandContext,
  filePath: string,
  serverConfigs: Record<string, unknown>,
) {
  const serverNames = Object.keys(serverConfigs);

  if (serverNames.length === 0) {
    ctx.ui.notify(`No MCP servers found in ${filePath}`);
    return undefined;
  }

  return await ctx.ui.custom<string | null>(
    (tui, theme, _keybindings, done) =>
      new Picker<string>(
        "server",
        {
          items: serverNames,
          itemLimit: 10,
          title: "Which MCP server do you want to edit?",
        },
        theme,
        tui,
        done,
      ),
    formOverlayOptions,
  );
}

interface PickedServer {
  name: string;
  config: McpServerConfig;
}

async function pickStdioServer(
  ctx: ExtensionCommandContext,
  stored?: { name: string; config: McpStdioConfig },
): Promise<PickedServer | undefined> {
  const initialForms =
    stored && toMcpStdioServerForms(stored.name, stored.config);

  const required = await ctx.ui.custom<StdioServerRequiredFields | null>(
    (tui, theme, _keybindings, done) =>
      createStdioServerForm(tui, theme, done, initialForms?.required),
    formOverlayOptions,
  );

  if (!required) {
    return undefined;
  }

  const optional = required.optionalFields
    ? await pickStdioOptionalFields(ctx, initialForms?.optional)
    : emptyStdioOptionalFields();

  if (!optional) {
    return undefined;
  }

  return {
    name: required.name.trim(),
    config: renderStdioServerConfig(required, optional),
  };
}

async function pickStdioOptionalFields(
  ctx: ExtensionCommandContext,
  initialValues?: StdioServerOptionalFields,
) {
  return await ctx.ui.custom<StdioServerOptionalFields | null>(
    (tui, theme, _keybindings, done) =>
      createStdioServerDetailsForm(tui, theme, done, initialValues),
    formOverlayOptions,
  );
}

async function pickHttpServer(
  ctx: ExtensionCommandContext,
  stored?: { name: string; config: McpHttpConfig },
): Promise<PickedServer | undefined> {
  const initialForms =
    stored && toMcpHttpServerForms(stored.name, stored.config);

  const required = await ctx.ui.custom<HttpServerRequiredFields | null>(
    (tui, theme, _keybindings, done) =>
      createHttpServerForm(tui, theme, done, initialForms?.required),
    formOverlayOptions,
  );

  if (!required) {
    return undefined;
  }

  const optional = required.optionalFields
    ? await pickHttpOptionalFields(ctx, initialForms?.optional)
    : emptyHttpOptionalFields();

  if (!optional) {
    return undefined;
  }

  if (!required.oauthFields) {
    return {
      name: required.name.trim(),
      config: renderHttpServerConfig(required, optional),
    };
  }

  const oauth = await pickOAuthFields(ctx, stored?.config.oauth);

  // Cancelling must never drop an oauth block the file already has.
  if (!oauth) {
    return stored?.config.oauth === undefined
      ? {
          name: required.name.trim(),
          config: renderHttpServerConfig(required, optional),
        }
      : undefined;
  }

  return {
    name: required.name.trim(),
    config: renderHttpServerConfig(required, optional, oauth),
  };
}

async function pickHttpOptionalFields(
  ctx: ExtensionCommandContext,
  initialValues?: HttpServerOptionalFields,
) {
  return await ctx.ui.custom<HttpServerOptionalFields | null>(
    (tui, theme, _keybindings, done) =>
      createHttpServerDetailsForm(tui, theme, done, initialValues),
    formOverlayOptions,
  );
}

async function pickOAuthFields(
  ctx: ExtensionCommandContext,
  oauth: McpOAuthConfig | undefined,
) {
  return (
    (await ctx.ui.custom<OAuthFields | null>(
      (tui, theme, _keybindings, done) =>
        createOAuthForm(tui, theme, done, toMcpOAuthFields(oauth)),
      formOverlayOptions,
    )) ?? undefined
  );
}

/** Map a stored config back onto the form fields, so edit starts from what is there. */
export function toMcpStdioServerForms(
  serverName: string,
  serverConfig: McpStdioConfig,
) {
  const optional = {
    args: renderArguments(serverConfig.args ?? []),
    env: renderKeyValueList(serverConfig.env),
    cwd: serverConfig.cwd ?? "",
    exposure: serverConfig.exposure ?? "",
    timeout: renderNumber(serverConfig.timeout),
  };

  return {
    required: {
      name: serverName,
      command: serverConfig.command,
      optionalFields: hasAnyFilledValue(optional),
    },
    optional,
  };
}

export function toMcpHttpServerForms(
  serverName: string,
  serverConfig: McpHttpConfig,
) {
  const optional = {
    headers: renderKeyValueList(serverConfig.headers),
    exposure: serverConfig.exposure ?? "",
    timeout: renderNumber(serverConfig.timeout),
  };

  return {
    required: {
      name: serverName,
      url: serverConfig.url,
      optionalFields: hasAnyFilledValue(optional),
      oauthFields: serverConfig.oauth !== undefined,
    },
    optional,
  };
}

function emptyStdioOptionalFields(): StdioServerOptionalFields {
  return { args: "", env: "", cwd: "", exposure: "", timeout: "" };
}

function emptyHttpOptionalFields(): HttpServerOptionalFields {
  return { headers: "", exposure: "", timeout: "" };
}

/** A stored server with nothing optional set should not send the user to the second form. */
function hasAnyFilledValue(fields: Record<string, string>) {
  return Object.values(fields).some((value) => value.trim().length > 0);
}

/** The form needs a string for every field, so an unconfigured oauth block starts blank. */
export function toMcpOAuthFields(
  oauth: McpOAuthConfig | undefined,
): Partial<OAuthFields> {
  return {
    clientId: oauth?.clientId ?? "",
    clientSecret: oauth?.clientSecret ?? "",
    scope: oauth?.scope ?? "",
    callbackPort: renderNumber(oauth?.callbackPort),
    callbackUrl: oauth?.callbackUrl ?? "",
  };
}

function renderOAuthConfig(oauth: OAuthFields) {
  const config: McpOAuthConfig = {
    clientId: oauth.clientId.trim(),
    clientSecret: oauth.clientSecret.trim(),
    scope: oauth.scope.trim(),
    callbackPort: toOptionalNumber(oauth.callbackPort),
    callbackUrl: oauth.callbackUrl.trim(),
  };

  return removeEmptyValues(config);
}

/** The form only accepts the exposures pi has, and a blank one leaves the choice to pi. */
function toExposure(value: string) {
  return EXPOSURES.find((exposure) => exposure === value);
}

function preserveUnmanagedServerFields(
  existingConfig: unknown,
  updatedConfig: McpServerConfig,
) {
  if (!isRecord(existingConfig)) {
    return updatedConfig;
  }

  const unmanagedFields = Object.fromEntries(
    Object.entries(existingConfig).filter(
      ([fieldName]) => !FORM_MANAGED_SERVER_FIELDS.has(fieldName),
    ),
  );

  return { ...unmanagedFields, ...updatedConfig };
}

function parseMcpFile(content: string) {
  const parsedJson = parseJson(content);

  if (!parsedJson.success) {
    return {
      file: {},
      serverConfigs: {},
      fileError: `${MCP_FILE_NAME} is not valid JSON`,
    };
  }

  if (!isRecord(parsedJson.value)) {
    return {
      file: {},
      serverConfigs: {},
      fileError: `${MCP_FILE_NAME} is not valid JSON`,
    };
  }

  const parsedFile = safeParse(mcpFileSchema, parsedJson.value);

  if (!parsedFile.success) {
    return {
      file: parsedJson.value,
      serverConfigs: {},
      fileError: `${MCP_FILE_NAME} has no "mcpServers" object`,
    };
  }

  return {
    file: parsedJson.value,
    serverConfigs: parsedFile.output.mcpServers,
  };
}

function collectAcceptedServers(serverConfigs: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(serverConfigs).flatMap(([name, value]) => {
      const result = parseMcpServerConfig(name, value);

      return result.success ? [[name, result.config] as const] : [];
    }),
  );
}

function collectServerErrors(serverConfigs: Record<string, unknown>) {
  return Object.entries(serverConfigs).flatMap(([name, value]) => {
    const result = parseMcpServerConfig(name, value);

    return result.success ? [] : [result.error];
  });
}

function renderMcpFile(file: Record<string, unknown>) {
  return `${JSON.stringify(file, null, 2)}\n`;
}

function reportFileError(
  ctx: ExtensionCommandContext,
  contents: McpFileContents,
) {
  if (!contents.fileError) {
    return false;
  }

  ctx.ui.notify(contents.fileError, "error");
  return true;
}

/** Drop the keys the form left blank, so a config only carries the fields that were filled in. */
function removeEmptyValues<T extends object>(values: T): FilledValues<T> {
  // Object.fromEntries widens the value types, so the shape is restored here.
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => !isEmptyValue(value)),
  ) as FilledValues<T>;
}

function isEmptyValue(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return true;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  return isRecord(value) && Object.keys(value).length === 0;
}

function splitArguments(value: string) {
  return (value.match(ARGUMENT_PATTERN) ?? []).map(
    (argument) => argument.match(QUOTED_ARGUMENT_PATTERN)?.at(2) ?? argument,
  );
}

/**
 * Every character has to land inside an argument, so a quote that is never closed or a
 * quote inside an argument is rejected instead of being silently dropped.
 */
function isArgsList(value: string) {
  return value.replace(/\s/g, "") === splitArguments(value).join("");
}

function renderArguments(args: ReadonlyArray<string>) {
  return args
    .map((argument) => (/[\s"']/.test(argument) ? `"${argument}"` : argument))
    .join(" ");
}

function splitCommaList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseKeyValueList(value: string) {
  return Object.fromEntries(
    splitCommaList(value).map((pair) => {
      const separatorIndex = pair.indexOf("=");
      return [
        pair.slice(0, separatorIndex).trim(),
        pair.slice(separatorIndex + 1).trim(),
      ];
    }),
  );
}

function renderKeyValueList(values: Record<string, string> | undefined) {
  return Object.entries(values ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
}

function renderNumber(value: number | undefined) {
  return value === undefined ? "" : String(value);
}

function toOptionalNumber(value: string) {
  const trimmedValue = value.trim();
  return trimmedValue === "" ? undefined : Number(trimmedValue);
}

function isKeyValueList(value: string, namePattern: RegExp) {
  return splitCommaList(value).every((pair) => {
    const separatorIndex = pair.indexOf("=");
    const name = pair.slice(0, separatorIndex).trim();
    return separatorIndex > 0 && namePattern.test(name);
  });
}

function isPositiveIntegerOrEmpty(value: string) {
  const trimmedValue = value.trim();
  return trimmedValue === "" || POSITIVE_INTEGER_PATTERN.test(trimmedValue);
}

function isExposure(value: string) {
  return (EXPOSURES as ReadonlyArray<string>).includes(value);
}

function isHttpUrl(value: string) {
  const url = value.trim();

  if (!URL.canParse(url)) {
    return false;
  }

  return /^https?:$/.test(new URL(url).protocol);
}

function isLoopbackHttpUrl(value: string) {
  const url = value.trim();

  if (!URL.canParse(url)) {
    return false;
  }

  const loopbackUrl = new URL(url);

  // Only plain http is allowed: RFC 8252 redirects a browser to a loopback listener.
  return (
    loopbackUrl.protocol === "http:" &&
    LOOPBACK_HOSTS.includes(loopbackUrl.hostname)
  );
}

function getScopeLabel(scope: McpScope) {
  return scope === "global"
    ? "your global MCP servers"
    : "this project's MCP servers";
}

function announceScope(
  ctx: ExtensionCommandContext,
  scope: McpScope,
  deps: McpCraftDeps,
) {
  if (scope === "local") {
    ctx.ui.notify(`Using ${deps.getMcpFilePath(scope)}`, "info");
  }
}

function createDeps(ctx: ExtensionCommandContext): McpCraftDeps {
  const cwd = ctx.cwd || process.cwd();

  return {
    fileSystem: new NodeFileSystem(),
    getMcpFilePath: createMcpFilePathResolver({ cwd }),
    openExternalEditor: async (filePath) => {
      const editor = process.env.VISUAL || process.env.EDITOR;

      if (!editor) {
        return new Error("Set $VISUAL or $EDITOR to edit MCP servers");
      }

      const result = await ctx.ui.custom<Error | { changed: boolean }>(
        createExternalEditorFactory(editor, filePath),
        modalEditorOverlayOptions,
      );

      return result instanceof Error ? result : undefined;
    },
  };
}

export default (pi: ExtensionAPI) => {
  pi.registerFlag(EDIT_FLAG, {
    description:
      "Edit the whole MCP file in your external editor instead of one server form",
    type: "boolean",
    default: false,
  });

  pi.registerCommand(GLOBAL_COMMAND, {
    description: "Manage MCP servers in ~/.pi/agent/mcp.json",
    getArgumentCompletions:
      getFilterSubcommandArgumentCompletionFromStringUsingSubLabel("mcp"),
    handler: async (argument, ctx) =>
      handleSubcommand(pi, argument, ctx, "global"),
  });

  pi.registerCommand(LOCAL_COMMAND, {
    description: "Manage MCP servers in this project's .pi/mcp.json",
    getArgumentCompletions:
      getFilterSubcommandArgumentCompletionFromStringUsingSubLabel("local mcp"),
    handler: async (argument, ctx) =>
      handleSubcommand(pi, argument, ctx, "local"),
  });
};

async function handleSubcommand(
  pi: ExtensionAPI,
  argument: string,
  ctx: ExtensionCommandContext,
  scope: McpScope,
) {
  const result = safeParse(subcommands, argument.trim());

  if (!result.success) {
    ctx.ui.notify(summarize(result.issues), "error");
    return;
  }

  const externalEdit = pi.getFlag(EDIT_FLAG) === true;

  if (externalEdit && result.output !== "edit") {
    ctx.ui.notify(
      `Invalid command: --${EDIT_FLAG} can only be used with edit`,
      "error",
    );
    return;
  }

  const deps = createDeps(ctx);
  const handlers: Record<Subcommand, () => Promise<void>> = {
    create: async () => handleCreate(ctx, scope, deps),
    edit: async () => handleEdit(ctx, externalEdit, scope, deps),
    delete: async () => handleDelete(ctx, scope, deps),
  };

  await handlers[result.output]();
}
