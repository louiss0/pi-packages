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
  NodeFileSystem,
  type ResourceFileSystem,
} from "../shared/filesystem";
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

const EXPOSURES = [
  "codemode",
  "codemode-deferred",
  "deferred",
  "direct",
  "hidden",
] as const;

const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const FORM_MANAGED_SERVER_FIELDS = new Set([
  "type",
  "command",
  "args",
  "env",
  "cwd",
  "url",
  "headers",
  "oauth",
  "exposure",
  "timeout",
]);

export type McpScope = "global" | "local";
export type McpTransport = typeof STDIO_TRANSPORT | typeof HTTP_TRANSPORT;
export type McpFilePathResolver = (scope: McpScope) => string;

/** Pi's own config types, narrowed so a form can read the fields of one transport. */
type McpStdioConfig = Extract<McpServerConfig, { command: string }>;
type McpHttpConfig = Extract<McpServerConfig, { url: string }>;
type McpOAuthConfig = NonNullable<McpHttpConfig["oauth"]>;

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
    pipe(
      number(),
      minValue(1, "Timeout must be a positive number of seconds"),
    ),
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

  const transport = getEntryTransport(value);
  const result = safeParse(getServerSchema(transport), value);

  if (!result.success) {
    return { success: false, error: `server "${name}": ${summarize(result.issues)}` };
  }

  return {
    success: true,
    config: { ...result.output, type: transport } as McpServerConfig,
  };
}

export async function readMcpFile(
  fileSystem: ResourceFileSystem,
  getMcpFilePath: McpFilePathResolver,
  scope: McpScope,
): Promise<McpFileContents> {
  const result = await fileSystem.readFile(getMcpFilePath(scope));

  if (!result.success) {
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
  minLength(1, "Name is required"),
  maxLength(64, "Name must be 64 characters or fewer"),
  regex(MCP_SERVER_NAME_PATTERN, 'Name must be letters, digits, "_" and "-" only'),
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

const StdioServerFormSchema = object({
  name: serverNameField,
  command: pipe(string(), minLength(1, "Command is required")),
  args: optional(pipe(string(), check(isSeparatedList, "Args must be comma separated")), ""),
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

const HttpServerFormSchema = object({
  name: serverNameField,
  url: pipe(
    string(),
    minLength(1, "URL is required"),
    check(isHttpUrl, "URL must be an http or https URL"),
  ),
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
  confirm: boolean(),
});

const OAuthFormSchema = object({
  clientId: optional(string(), ""),
  clientSecret: optional(string(), ""),
  scope: optional(string(), ""),
  callbackPort: optional(
    pipe(
      string(),
      check(isPositiveIntegerOrEmpty, "Callback port must be a positive number"),
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

export type StdioServerFields = InferOutput<typeof StdioServerFormSchema>;
export type HttpServerFields = InferOutput<typeof HttpServerFormSchema>;
export type OAuthFields = InferOutput<typeof OAuthFormSchema>;

export function parseStdioServerFormValues(values: StdioServerFields) {
  return parseObjectErrors(StdioServerFormSchema, values);
}

export function parseHttpServerFormValues(values: HttpServerFields) {
  return parseObjectErrors(HttpServerFormSchema, values);
}

export function parseOAuthFormValues(values: OAuthFields) {
  return parseObjectErrors(OAuthFormSchema, values);
}

export function renderStdioServerConfig(
  fields: StdioServerFields,
): McpServerConfig {
  // removeEmptyValues drops the optional keys, which leaves a valid config behind.
  return removeEmptyValues({
    type: STDIO_TRANSPORT,
    command: fields.command.trim(),
    args: splitCommaList(fields.args),
    env: parseKeyValueList(fields.env),
    cwd: fields.cwd.trim(),
    exposure: fields.exposure.trim(),
    timeout: toOptionalNumber(fields.timeout),
  }) as unknown as McpStdioConfig;
}

export function renderHttpServerConfig(
  fields: HttpServerFields,
  oauth?: OAuthFields,
): McpServerConfig {
  return removeEmptyValues({
    type: HTTP_TRANSPORT,
    url: fields.url.trim(),
    headers: parseKeyValueList(fields.headers),
    oauth: oauth ? renderOAuthConfig(oauth) : undefined,
    exposure: fields.exposure.trim(),
    timeout: toOptionalNumber(fields.timeout),
  }) as unknown as McpHttpConfig;
}

export function createStdioServerForm(
  tui: TUI,
  theme: Theme,
  done: (value: StdioServerFields | null) => void,
  initialValues: Partial<StdioServerFields> = {},
) {
  return new Form<StdioServerFields>(
    {
      title: "MCP Server (stdio)",
      fields: [
        new LabelledInput("name", theme, initialValues.name),
        new LabelledInput("command", theme, initialValues.command),
        new LabelledInput("args", theme, initialValues.args),
        new LabelledInput("env", theme, initialValues.env),
        new LabelledInput("cwd", theme, initialValues.cwd),
        new LabelledInput("exposure", theme, initialValues.exposure),
        new LabelledInput("timeout", theme, initialValues.timeout),
      ],
      parse: parseStdioServerFormValues,
      footer: [
        "* required | blank optional fields are left out of mcp.json",
        "args and env are comma separated | env keeps ${VAR} and !command as written",
        `exposure: ${EXPOSURES.join(" | ")} | blank keeps pi's default of codemode`,
        "timeout is in seconds | space toggles the checkbox",
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
  done: (value: HttpServerFields | null) => void,
  initialValues: Partial<HttpServerFields> = {},
) {
  return new Form<HttpServerFields>(
    {
      title: "MCP Server (http)",
      fields: [
        new LabelledInput("name", theme, initialValues.name),
        new LabelledInput("url", theme, initialValues.url),
        new LabelledInput("headers", theme, initialValues.headers),
        new LabelledInput("exposure", theme, initialValues.exposure),
        new LabelledInput("timeout", theme, initialValues.timeout),
        new ConfirmationBox("confirm", theme, "Configure OAuth for this server?"),
      ],
      parse: parseHttpServerFormValues,
      footer: [
        "* required | blank optional fields are left out of mcp.json",
        "headers are Name=Value pairs separated by commas",
        `exposure: ${EXPOSURES.join(" | ")} | blank keeps pi's default of codemode`,
        "timeout is in seconds | space toggles a checkbox",
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
        "Esc cancel keeps the server without oauth",
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

  const fields = await pickServerFields(ctx, transport);

  if (!fields) {
    ctx.ui.notify("MCP server creation cancelled", "info");
    return;
  }

  const oauth = await pickOAuthFields(ctx, transport, fields);
  const contents = await readMcpFile(deps.fileSystem, deps.getMcpFilePath, scope);

  if (reportFileError(ctx, contents)) {
    return;
  }

  const serverName = getServerName(fields);
  const writeResult = await writeMcpFile(
    deps.fileSystem,
    deps.getMcpFilePath,
    scope,
    { ...contents.serverConfigs, [serverName]: getServerConfig(fields, transport, oauth) },
  );

  if (!writeResult.success) {
    ctx.ui.notify(`MCP server creation failed: ${writeResult.error.message}`, "error");
    return;
  }

  ctx.ui.notify(`Added MCP server '${serverName}' to ${getScopeLabel(scope)}`);
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
  const contents = await readMcpFile(deps.fileSystem, deps.getMcpFilePath, scope);

  if (reportFileError(ctx, contents)) {
    return;
  }

  const serverName = await pickServerName(ctx, filePath, contents.serverConfigs);

  if (!serverName) {
    return;
  }

  const serverConfig = contents.servers[serverName];

  if (!serverConfig) {
    ctx.ui.notify(`MCP server '${serverName}' is not valid`, "error");
    return;
  }

  const transport = getTransport(serverConfig);
  const fields = await pickServerFields(
    ctx,
    transport,
    toMcpServerFields(serverName, serverConfig),
  );

  if (!fields) {
    ctx.ui.notify("MCP server edit cancelled", "info");
    return;
  }

  const oauth = await pickOAuthFields(ctx, transport, fields, serverConfig);
  const writeResult = await writeMcpFile(
    deps.fileSystem,
    deps.getMcpFilePath,
    scope,
    {
      ...contents.serverConfigs,
      [serverName]: preserveUnmanagedServerFields(
        contents.serverConfigs[serverName],
        getServerConfig(fields, transport, oauth),
      ),
    },
  );

  if (!writeResult.success) {
    ctx.ui.notify(`MCP server edit failed: ${writeResult.error.message}`, "error");
    return;
  }

  ctx.ui.notify(`Updated MCP server '${serverName}' in ${getScopeLabel(scope)}`);
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
  const contents = await readMcpFile(deps.fileSystem, deps.getMcpFilePath, scope);

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
    ctx.ui.notify(`MCP server delete failed: ${writeResult.error.message}`, "error");
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
    ctx.ui.notify(`MCP file creation failed: ${fileResult.error.message}`, "error");
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
    return { success: true as const, data: undefined };
  }

  if (!isNotFoundError(existingFile.error)) {
    return existingFile;
  }

  const directoryResult = await fileSystem.mkdir(dirname(filePath), {
    recursive: true,
  });

  if (!directoryResult.success) {
    return directoryResult;
  }

  return fileSystem.writeFile(
    filePath,
    renderMcpFile({ mcpServers: {} }),
  );
}

function isNotFoundError(error: Error) {
  return "code" in error && error.code === "ENOENT";
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

async function pickServerFields(
  ctx: ExtensionCommandContext,
  transport: McpTransport,
  initialValues?: StdioServerFields | HttpServerFields,
) {
  if (transport === HTTP_TRANSPORT) {
    return await ctx.ui.custom<HttpServerFields | null>(
      (tui, theme, _keybindings, done) =>
        createHttpServerForm(
          tui,
          theme,
          done,
          initialValues as Partial<HttpServerFields> | undefined,
        ),
      formOverlayOptions,
    );
  }

  return await ctx.ui.custom<StdioServerFields | null>(
    (tui, theme, _keybindings, done) =>
      createStdioServerForm(
        tui,
        theme,
        done,
        initialValues as Partial<StdioServerFields> | undefined,
      ),
    formOverlayOptions,
  );
}

async function pickOAuthFields(
  ctx: ExtensionCommandContext,
  transport: McpTransport,
  fields: StdioServerFields | HttpServerFields,
  serverConfig?: McpServerConfig,
) {
  if (transport !== HTTP_TRANSPORT) {
    return undefined;
  }

  const oauth = serverConfig && "url" in serverConfig
    ? serverConfig.oauth
    : undefined;
  const wantsOAuth = "confirm" in fields ? fields.confirm : oauth !== undefined;

  if (!wantsOAuth) {
    return undefined;
  }

  return (await ctx.ui.custom<OAuthFields | null>(
    (tui, theme, _keybindings, done) =>
      createOAuthForm(tui, theme, done, toMcpOAuthFields(oauth)),
    formOverlayOptions,
  )) ?? undefined;
}

/** Map a stored config back onto the form fields, so edit starts from what is there. */
export function toMcpServerFields(
  serverName: string,
  serverConfig: McpServerConfig,
): StdioServerFields | HttpServerFields {
  const sharedValues = {
    name: serverName,
    exposure: serverConfig.exposure ?? "",
    timeout: renderNumber(serverConfig.timeout),
  };

  if ("url" in serverConfig) {
    return {
      ...sharedValues,
      url: serverConfig.url,
      headers: renderKeyValueList(serverConfig.headers),
      confirm: serverConfig.oauth !== undefined,
    };
  }

  return {
    ...sharedValues,
    command: serverConfig.command,
    args: serverConfig.args?.join(", ") ?? "",
    env: renderKeyValueList(serverConfig.env),
    cwd: serverConfig.cwd ?? "",
  };
}

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
  return removeEmptyValues({
    clientId: oauth.clientId.trim(),
    clientSecret: oauth.clientSecret.trim(),
    scope: oauth.scope.trim(),
    callbackPort: toOptionalNumber(oauth.callbackPort),
    callbackUrl: oauth.callbackUrl.trim(),
  });
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

function getServerName(fields: StdioServerFields | HttpServerFields) {
  return fields.name.trim();
}

function getServerConfig(
  fields: StdioServerFields | HttpServerFields,
  transport: McpTransport,
  oauth?: OAuthFields,
) {
  return transport === HTTP_TRANSPORT
    ? renderHttpServerConfig(fields as HttpServerFields, oauth)
    : renderStdioServerConfig(fields as StdioServerFields);
}

function getServerSchema(transport: McpTransport) {
  return transport === HTTP_TRANSPORT ? httpServerSchema : stdioServerSchema;
}

function getEntryTransport(value: Record<string, unknown>): McpTransport {
  return typeof value.url === "string" ? HTTP_TRANSPORT : STDIO_TRANSPORT;
}

function getTransport(serverConfig: McpServerConfig): McpTransport {
  return "url" in serverConfig ? HTTP_TRANSPORT : STDIO_TRANSPORT;
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

function reportFileError(ctx: ExtensionCommandContext, contents: McpFileContents) {
  if (!contents.fileError) {
    return false;
  }

  ctx.ui.notify(contents.fileError, "error");
  return true;
}

function removeEmptyValues(values: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => !isEmptyValue(value)),
  );
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

function isSeparatedList(value: string) {
  return value.trim() === "" || value.split(",").every((item) => item.trim() !== "");
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
  if (!URL.canParse(value)) {
    return false;
  }

  return /^https?:$/.test(new URL(value).protocol);
}

function isLoopbackHttpUrl(value: string) {
  if (!URL.canParse(value)) {
    return false;
  }

  const url = new URL(value);

  return url.protocol === "http:" && LOOPBACK_HOSTS.includes(url.hostname);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(content: string) {
  try {
    return { success: true as const, value: JSON.parse(content) as unknown };
  } catch {
    return { success: false as const };
  }
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
    handler: async (argument, ctx) => handleSubcommand(pi, argument, ctx, "global"),
  });

  pi.registerCommand(LOCAL_COMMAND, {
    description: "Manage MCP servers in this project's .pi/mcp.json",
    getArgumentCompletions:
      getFilterSubcommandArgumentCompletionFromStringUsingSubLabel("local mcp"),
    handler: async (argument, ctx) => handleSubcommand(pi, argument, ctx, "local"),
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
