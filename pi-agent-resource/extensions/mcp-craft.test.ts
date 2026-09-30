import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  McpServerConfig,
  RegisteredCommand,
} from "@earendil-works/pi-coding-agent";

import {
  MemoryFileSystem,
  type ResourceFileSystem,
} from "../shared/filesystem";
import mcpCraft, {
  createMcpFilePathResolver,
  handleCreate,
  handleDelete,
  handleEdit,
  parseHttpServerFormValues,
  parseHttpServerOptionalFormValues,
  parseMcpServerConfig,
  parseOAuthFormValues,
  parseStdioServerFormValues,
  parseStdioServerOptionalFormValues,
  readMcpFile,
  renderHttpServerConfig,
  renderStdioServerConfig,
  toMcpHttpServerForms,
  toMcpOAuthFields,
  toMcpStdioServerForms,
  writeMcpFile,
  type McpCraftDeps,
} from "./mcp-craft";

const workspace = "/workspace";
const home = "/test-home";

const globalPath = join(home, ".pi", "agent", "mcp.json");
const localPath = join(workspace, ".pi", "mcp.json");

const stdioRequiredFields = {
  name: "github",
  command: "npx",
  optionalFields: true,
};

const stdioOptionalFields = {
  args: "-y github-mcp",
  env: "GITHUB_TOKEN=${GITHUB_TOKEN}",
  cwd: "",
  exposure: "direct",
  timeout: "30",
};

const emptyStdioOptionalFields = {
  args: "",
  env: "",
  cwd: "",
  exposure: "",
  timeout: "",
};

const httpRequiredFields = {
  name: "sentry",
  url: "https://mcp.sentry.dev/mcp",
  optionalFields: true,
  oauthFields: false,
};

const httpOptionalFields = {
  headers: "Authorization=Bearer ${SENTRY_TOKEN}",
  exposure: "",
  timeout: "",
};

const emptyHttpOptionalFields = {
  headers: "",
  exposure: "",
  timeout: "",
};

const oauthFields = {
  clientId: "my-client",
  clientSecret: "${CLIENT_SECRET}",
  scope: "read write",
  callbackPort: "8765",
  callbackUrl: "",
};

type TestDeps = McpCraftDeps & {
  answers: unknown[];
  notifications: string[];
  reloads: number;
};

function createDeps(answers: {
  custom?: unknown[];
  fileSystem?: MemoryFileSystem;
  openExternalEditor?: (filePath: string) => Promise<Error | undefined>;
}): TestDeps {
  return {
    answers: [...(answers.custom ?? [])],
    fileSystem: answers.fileSystem ?? new MemoryFileSystem(),
    getMcpFilePath: createMcpFilePathResolver({
      cwd: workspace,
      homePath: home,
    }),
    notifications: [],
    openExternalEditor: answers.openExternalEditor ?? vi.fn(),
    reloads: 0,
  };
}

function createCommandContext(deps: TestDeps) {
  return {
    ui: {
      custom: async () => deps.answers.shift() ?? null,
      input: async () => null,
      notify: (message: string) => deps.notifications.push(message),
      select: async () => null,
    },
    cwd: workspace,
    reload: async () => {
      deps.reloads += 1;
    },
  } as unknown as ExtensionCommandContext;
}

async function seed(
  fileSystem: ResourceFileSystem,
  filePath: string,
  mcpServers: Record<string, unknown>,
) {
  await fileSystem.mkdir(dirname(filePath), { recursive: true });
  await fileSystem.writeFile(filePath, JSON.stringify({ mcpServers }));
}

const EDIT_FLAG = "resource:mcp-craft-edit";
const GLOBAL_COMMAND = "resource:mcp";
const LOCAL_COMMAND = "resource:local-mcp";

function createExtensionApi() {
  const commands = new Map<string, RegisteredCommand>();
  const flags = new Map<string, boolean>();

  mcpCraft({
    getFlag: (name: string) => flags.get(name),
    registerCommand: (
      name: string,
      command: Omit<RegisteredCommand, "name" | "sourceInfo">,
    ) => {
      commands.set(name, {
        ...command,
        name,
        sourceInfo: {},
      } as RegisteredCommand);
    },
    registerFlag: (
      name: string,
      options: { type: "boolean" | "string"; default?: boolean | string },
    ) => {
      flags.set(name, options.type === "boolean" && options.default === true);
    },
  } as unknown as ExtensionAPI);

  return { commands, flags };
}

function createSubcommandContext() {
  const notifications: string[] = [];

  return {
    ctx: {
      ui: {
        custom: async () => null,
        input: async () => null,
        notify: (message: string) => notifications.push(message),
        select: async () => null,
      },
      cwd: workspace,
      reload: async () => undefined,
    } as unknown as ExtensionCommandContext,
    notifications,
  };
}

describe("extensions/mcp-craft", () => {
  // memfs keeps one volume per module, so it has to be cleared between tests.
  afterEach(() => {
    new MemoryFileSystem().reset();
  });

  describe("createMcpFilePathResolver", () => {
    it("points each scope at the file pi reads", () => {
      const getMcpFilePath = createMcpFilePathResolver({
        cwd: workspace,
        homePath: home,
      });

      expect(getMcpFilePath("global")).toBe(globalPath);
      expect(getMcpFilePath("local")).toBe(localPath);
    });
  });

  describe("parseMcpServerConfig", () => {
    it("accepts a stdio server", () => {
      expect(
        parseMcpServerConfig("filesystem", {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem"],
          env: { LOG: "debug" },
        }),
      ).toEqual({
        success: true,
        config: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem"],
          env: { LOG: "debug" },
        },
      });
    });

    it("accepts a streamable http server", () => {
      expect(
        parseMcpServerConfig("docs", {
          type: "streamable-http",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer ${DOCS_TOKEN}" },
        }),
      ).toMatchObject({ success: true });
    });

    it("rejects the legacy sse transport", () => {
      expect(
        parseMcpServerConfig("legacy", {
          type: "sse",
          url: "https://example.com/sse",
        }),
      ).toEqual({
        success: false,
        error:
          'server "legacy": legacy SSE transport is not supported; use the streamable HTTP URL',
      });
    });

    it("rejects a name pi would not accept", () => {
      expect(parseMcpServerConfig("my server", { command: "npx" })).toEqual({
        success: false,
        error:
          'invalid server name "my server" (use letters, digits, "_" and "-")',
      });
    });

    it("rejects an entry with no transport", () => {
      expect(parseMcpServerConfig("empty", { exposure: "direct" })).toEqual({
        success: false,
        error:
          'server "empty" needs either "command" (stdio) or "url" (streamable HTTP)',
      });
    });

    it("prefers http when an entry has both a command and a url", () => {
      expect(
        parseMcpServerConfig("both", {
          command: "npx",
          url: "https://example.com/mcp",
        }),
      ).toMatchObject({
        success: true,
        config: { type: "http", url: "https://example.com/mcp" },
      });
    });

    it("ignores keys pi does not know so a hand written file still loads", () => {
      expect(
        parseMcpServerConfig("docs", {
          url: "https://example.com/mcp",
          bearer_token_env_var: "DOCS_TOKEN",
        }),
      ).toMatchObject({ success: true });
    });
  });

  describe("readMcpFile and writeMcpFile", () => {
    it("reports no servers and no errors for a file that does not exist", async () => {
      const deps = createDeps({});

      await expect(
        readMcpFile(deps.fileSystem, deps.getMcpFilePath, "global"),
      ).resolves.toEqual({
        file: {},
        serverConfigs: {},
        servers: {},
        errors: [],
      });
    });

    it("keeps the servers pi accepts and reports the ones it rejects", async () => {
      const deps = createDeps({});

      await seed(deps.fileSystem, globalPath, {
        github: { command: "npx" },
        legacy: { type: "sse", url: "https://example.com/sse" },
      });

      const contents = await readMcpFile(
        deps.fileSystem,
        deps.getMcpFilePath,
        "global",
      );

      expect(Object.keys(contents.servers)).toEqual(["github"]);
      expect(Object.keys(contents.serverConfigs)).toEqual(["github", "legacy"]);
      expect(contents.errors).toEqual([
        'server "legacy": legacy SSE transport is not supported; use the streamable HTTP URL',
      ]);
    });

    it("writes a file that reads back to the same servers", async () => {
      const deps = createDeps({});
      const servers = { github: { type: "stdio" as const, command: "npx" } };

      await writeMcpFile(
        deps.fileSystem,
        deps.getMcpFilePath,
        "global",
        servers,
      );

      await expect(
        readMcpFile(deps.fileSystem, deps.getMcpFilePath, "global"),
      ).resolves.toEqual({
        file: { mcpServers: servers },
        serverConfigs: servers,
        servers,
        errors: [],
      });
    });

    it("stops instead of overwriting when the existing file cannot be read", async () => {
      const fileSystem = new MemoryFileSystem();
      const deps = createDeps({ fileSystem });
      const existingServers = { github: { command: "npx" } };

      await seed(fileSystem, globalPath, existingServers);
      vi.spyOn(fileSystem, "readFile").mockResolvedValueOnce({
        success: false,
        error: new Error("permission denied"),
      });

      await expect(
        writeMcpFile(fileSystem, deps.getMcpFilePath, "global", {
          sentry: { type: "stdio", command: "npx" },
        }),
      ).resolves.toMatchObject({ success: false });

      const result = await fileSystem.readFile(globalPath);
      expect(JSON.parse(result.success ? result.data : "{}")).toEqual({
        mcpServers: existingServers,
      });
    });

    it("keeps other content in the file", async () => {
      const deps = createDeps({});

      await deps.fileSystem.mkdir(`${home}/.pi/agent`, { recursive: true });
      await deps.fileSystem.writeFile(
        globalPath,
        `${JSON.stringify({ autoEnableCodemode: false, mcpServers: {} }, null, 2)}\n`,
      );

      await writeMcpFile(deps.fileSystem, deps.getMcpFilePath, "global", {
        github: { type: "stdio", command: "npx" },
      });

      const content = await deps.fileSystem.readFile(globalPath);

      expect(JSON.parse(content.success ? content.data : "{}")).toEqual({
        autoEnableCodemode: false,
        mcpServers: { github: { type: "stdio", command: "npx" } },
      });
    });
  });

  describe("form values", () => {
    it("accepts the required stdio fields", () => {
      expect(parseStdioServerFormValues(stdioRequiredFields)).toBeUndefined();
    });

    it("rejects a command that is only whitespace", () => {
      expect(
        parseStdioServerFormValues({ ...stdioRequiredFields, command: "   " }),
      ).toMatchObject({ command: expect.any(Array) });
    });

    it("rejects a name that is only whitespace", () => {
      expect(
        parseStdioServerFormValues({ ...stdioRequiredFields, name: "  " }),
      ).toMatchObject({ name: expect.any(Array) });
    });

    it("accepts the optional stdio fields", () => {
      expect(
        parseStdioServerOptionalFormValues(stdioOptionalFields),
      ).toBeUndefined();
    });

    it("rejects stdio env that is not KEY=VALUE pairs", () => {
      expect(
        parseStdioServerOptionalFormValues({
          ...stdioOptionalFields,
          env: "GITHUB_TOKEN",
        }),
      ).toMatchObject({ env: expect.any(Array) });
    });

    it("rejects args with an unterminated quote", () => {
      expect(
        parseStdioServerOptionalFormValues({
          ...stdioOptionalFields,
          args: '-y "github mcp',
        }),
      ).toMatchObject({ args: expect.any(Array) });
    });

    it("rejects a timeout that is not a positive number of seconds", () => {
      expect(
        parseStdioServerOptionalFormValues({
          ...stdioOptionalFields,
          timeout: "-5",
        }),
      ).toMatchObject({ timeout: expect.any(Array) });
    });

    it("rejects an exposure pi does not have", () => {
      expect(
        parseStdioServerOptionalFormValues({
          ...stdioOptionalFields,
          exposure: "sometimes",
        }),
      ).toMatchObject({ exposure: expect.any(Array) });
    });

    it("accepts the required http fields", () => {
      expect(parseHttpServerFormValues(httpRequiredFields)).toBeUndefined();
    });

    it("accepts the optional http fields", () => {
      expect(
        parseHttpServerOptionalFormValues(httpOptionalFields),
      ).toBeUndefined();
    });

    it("rejects a url that is not http or https", () => {
      expect(
        parseHttpServerFormValues({
          ...httpRequiredFields,
          url: "ftp://example.com",
        }),
      ).toMatchObject({ url: expect.any(Array) });
    });

    it("accepts a callback port and rejects a non numeric one", () => {
      expect(parseOAuthFormValues(oauthFields)).toBeUndefined();
      expect(
        parseOAuthFormValues({ ...oauthFields, callbackPort: "auto" }),
      ).toMatchObject({ callbackPort: expect.any(Array) });
    });
  });

  describe("config rendering", () => {
    it("writes only the fields a stdio server has", () => {
      expect(
        renderStdioServerConfig(stdioRequiredFields, stdioOptionalFields),
      ).toEqual({
        type: "stdio",
        command: "npx",
        args: ["-y", "github-mcp"],
        env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
        exposure: "direct",
        timeout: 30,
      });
    });

    it("writes only the fields an http server has", () => {
      expect(
        renderHttpServerConfig(httpRequiredFields, httpOptionalFields),
      ).toEqual({
        type: "http",
        url: "https://mcp.sentry.dev/mcp",
        headers: { Authorization: "Bearer ${SENTRY_TOKEN}" },
      });
    });

    it("leaves out the optional fields that were left blank", () => {
      expect(
        renderStdioServerConfig(
          { ...stdioRequiredFields, optionalFields: false },
          emptyStdioOptionalFields,
        ),
      ).toEqual({ type: "stdio", command: "npx" });

      expect(
        renderHttpServerConfig(
          { ...httpRequiredFields, optionalFields: false },
          emptyHttpOptionalFields,
        ),
      ).toEqual({ type: "http", url: "https://mcp.sentry.dev/mcp" });
    });

    it("splits args on spaces so a comma stays part of the argument", () => {
      expect(
        renderStdioServerConfig(stdioRequiredFields, {
          ...stdioOptionalFields,
          args: "-y github-mcp --header=a,b",
        }),
      ).toMatchObject({
        args: ["-y", "github-mcp", "--header=a,b"],
      });
    });

    it("keeps a quoted arg with spaces as one argument", () => {
      expect(
        renderStdioServerConfig(stdioRequiredFields, {
          ...stdioOptionalFields,
          args: 'playwright --config "my config.json"',
        }),
      ).toMatchObject({ args: ["playwright", "--config", "my config.json"] });
    });

    it("adds oauth only when the third form was filled in", () => {
      expect(
        renderHttpServerConfig(
          httpRequiredFields,
          httpOptionalFields,
          oauthFields,
        ),
      ).toMatchObject({
        oauth: {
          clientId: "my-client",
          clientSecret: "${CLIENT_SECRET}",
          scope: "read write",
          callbackPort: 8765,
        },
      });
    });

    it("leaves server activity settings to Pi", () => {
      expect(
        renderStdioServerConfig(stdioRequiredFields, stdioOptionalFields),
      ).not.toHaveProperty("enabled");
      expect(
        renderHttpServerConfig(httpRequiredFields, httpOptionalFields),
      ).not.toHaveProperty("enabled");
    });
  });

  describe("toMcpStdioServerForms", () => {
    it("maps a stored stdio server back onto both form stages", () => {
      expect(
        toMcpStdioServerForms("github", {
          type: "stdio",
          command: "npx",
          args: ["-y", "github-mcp", "--header=a,b"],
          env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
          exposure: "direct",
          timeout: 30,
        }),
      ).toEqual({
        required: { name: "github", command: "npx", optionalFields: true },
        optional: {
          args: "-y github-mcp --header=a,b",
          env: "GITHUB_TOKEN=${GITHUB_TOKEN}",
          cwd: "",
          exposure: "direct",
          timeout: "30",
        },
      });
    });

    it("quotes a stored arg that contains a space", () => {
      expect(
        toMcpStdioServerForms("playwright", {
          type: "stdio",
          command: "playwright",
          args: ["--config", "my config.json"],
        }),
      ).toMatchObject({
        optional: { args: '--config "my config.json"' },
      });
    });

    it("skips the second stage for a server with nothing optional set", () => {
      expect(
        toMcpStdioServerForms("filesystem", {
          type: "stdio",
          command: "npx",
        }),
      ).toMatchObject({ required: { optionalFields: false } });
    });

    it("round trips a config through the form fields", () => {
      const config: McpServerConfig = {
        type: "stdio",
        command: "npx",
        args: ["-y", "github-mcp", "--header=a,b"],
        env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
        exposure: "direct",
        timeout: 30,
      };
      const { required, optional } = toMcpStdioServerForms("github", config);

      expect(renderStdioServerConfig(required, optional)).toEqual(config);
    });
  });

  describe("toMcpHttpServerForms", () => {
    it("maps a stored http server back onto both form stages", () => {
      expect(
        toMcpHttpServerForms("sentry", {
          type: "http",
          url: "https://mcp.sentry.dev/mcp",
          headers: { Authorization: "Bearer ${SENTRY_TOKEN}" },
          enabled: false,
        }),
      ).toEqual({
        required: {
          name: "sentry",
          url: "https://mcp.sentry.dev/mcp",
          optionalFields: true,
          oauthFields: false,
        },
        optional: {
          headers: "Authorization=Bearer ${SENTRY_TOKEN}",
          exposure: "",
          timeout: "",
        },
      });
    });

    it("asks for oauth again when the stored server has it", () => {
      expect(
        toMcpHttpServerForms("sentry", {
          type: "http",
          url: "https://mcp.sentry.dev/mcp",
          oauth: { clientId: "my-client" },
        }),
      ).toMatchObject({ required: { oauthFields: true } });
    });
  });

  describe("toMcpOAuthFields", () => {
    it("maps a stored oauth block back onto the form fields", () => {
      expect(
        toMcpOAuthFields({
          clientId: "my-client",
          callbackPort: 8765,
          scope: "read write",
        }),
      ).toEqual({
        clientId: "my-client",
        clientSecret: "",
        scope: "read write",
        callbackPort: "8765",
        callbackUrl: "",
      });
    });
  });

  describe("handleCreate", () => {
    it("adds a stdio server to the global file", async () => {
      const deps = createDeps({
        custom: ["stdio", stdioRequiredFields, stdioOptionalFields],
      });

      await handleCreate(createCommandContext(deps), "global", deps);

      await expect(
        readMcpFile(deps.fileSystem, deps.getMcpFilePath, "global"),
      ).resolves.toMatchObject({
        servers: { github: { type: "stdio", command: "npx" } },
      });
      expect(deps.reloads).toBe(1);
    });

    it("adds a stdio server without asking for optional fields", async () => {
      const deps = createDeps({
        custom: ["stdio", { ...stdioRequiredFields, optionalFields: false }],
      });

      await handleCreate(createCommandContext(deps), "global", deps);

      await expect(
        readMcpFile(deps.fileSystem, deps.getMcpFilePath, "global"),
      ).resolves.toMatchObject({
        servers: { github: { type: "stdio", command: "npx" } },
      });
    });

    it("adds an http server with oauth to the project file", async () => {
      const deps = createDeps({
        custom: [
          "http",
          { ...httpRequiredFields, oauthFields: true },
          httpOptionalFields,
          oauthFields,
        ],
      });

      await handleCreate(createCommandContext(deps), "local", deps);

      await expect(
        readMcpFile(deps.fileSystem, deps.getMcpFilePath, "local"),
      ).resolves.toMatchObject({
        servers: {
          sentry: {
            type: "http",
            url: "https://mcp.sentry.dev/mcp",
            oauth: { clientId: "my-client" },
          },
        },
      });
    });

    it("refuses to replace a server that already exists", async () => {
      const deps = createDeps({
        custom: ["stdio", stdioRequiredFields, stdioOptionalFields],
      });

      await seed(deps.fileSystem, globalPath, {
        github: { command: "npx", args: ["-y", "other"] },
      });

      await handleCreate(createCommandContext(deps), "global", deps);

      const result = await deps.fileSystem.readFile(globalPath);
      expect(JSON.parse(result.success ? result.data : "{}")).toEqual({
        mcpServers: { github: { command: "npx", args: ["-y", "other"] } },
      });
      expect(deps.notifications).toContain(
        "MCP server 'github' already exists in your global MCP servers. Use edit to change it",
      );
      expect(deps.reloads).toBe(0);
    });

    it("keeps the servers already in the file", async () => {
      const deps = createDeps({
        custom: ["stdio", stdioRequiredFields, stdioOptionalFields],
      });

      await seed(deps.fileSystem, globalPath, {
        sentry: { url: "https://x.dev" },
      });

      await handleCreate(createCommandContext(deps), "global", deps);

      const contents = await readMcpFile(
        deps.fileSystem,
        deps.getMcpFilePath,
        "global",
      );

      expect(Object.keys(contents.servers)).toEqual(["sentry", "github"]);
    });

    it("stops without writing when the file cannot be read", async () => {
      const deps = createDeps({
        custom: ["stdio", stdioRequiredFields, stdioOptionalFields],
      });
      const existingServers = { github: { command: "npx" } };

      await seed(deps.fileSystem, globalPath, existingServers);
      vi.spyOn(deps.fileSystem, "readFile").mockResolvedValueOnce({
        success: false,
        error: new Error("permission denied"),
      });

      await handleCreate(createCommandContext(deps), "global", deps);

      const result = await deps.fileSystem.readFile(globalPath);
      expect(JSON.parse(result.success ? result.data : "{}")).toEqual({
        mcpServers: existingServers,
      });
      expect(deps.reloads).toBe(0);
    });

    it("does not overwrite an invalid MCP file", async () => {
      const deps = createDeps({
        custom: ["stdio", stdioRequiredFields, stdioOptionalFields],
      });
      const invalidJson = "{ invalid json";

      await seed(deps.fileSystem, globalPath, {});
      await deps.fileSystem.writeFile(globalPath, invalidJson);

      await handleCreate(createCommandContext(deps), "global", deps);

      const result = await deps.fileSystem.readFile(globalPath);
      expect(result).toMatchObject({ success: true, data: invalidJson });
      expect(deps.reloads).toBe(0);
    });

    it("writes nothing when the form is cancelled", async () => {
      const deps = createDeps({ custom: ["stdio", null] });

      await handleCreate(createCommandContext(deps), "global", deps);

      await expect(deps.fileSystem.readFile(globalPath)).resolves.toMatchObject(
        { success: false },
      );
      expect(deps.reloads).toBe(0);
    });
  });

  describe("handleEdit", () => {
    it("opens the whole file in the external editor when the flag is set", async () => {
      const openExternalEditor = vi.fn(async () => undefined);
      const deps = createDeps({ custom: [], openExternalEditor });

      await seed(deps.fileSystem, globalPath, { github: { command: "npx" } });

      await handleEdit(createCommandContext(deps), true, "global", deps);

      expect(openExternalEditor).toHaveBeenCalledWith(globalPath);
    });

    it("does not overwrite existing servers before opening the external editor", async () => {
      const deps = createDeps({ custom: [] });
      const existingServers = {
        github: { command: "npx", args: ["-y", "github-mcp"] },
        sentry: { url: "https://mcp.sentry.dev/mcp" },
      };

      await seed(deps.fileSystem, globalPath, existingServers);

      await handleEdit(createCommandContext(deps), true, "global", deps);

      const result = await deps.fileSystem.readFile(globalPath);
      expect(result.success).toBe(true);
      expect(JSON.parse(result.success ? result.data : "{}")).toEqual({
        mcpServers: existingServers,
      });
    });

    it("opens a file that does not exist yet so there is something to edit", async () => {
      const openExternalEditor = vi.fn(async () => undefined);
      const deps = createDeps({ custom: [], openExternalEditor });

      await handleEdit(createCommandContext(deps), true, "local", deps);

      expect(openExternalEditor).toHaveBeenCalledWith(localPath);
      await expect(
        readMcpFile(deps.fileSystem, deps.getMcpFilePath, "local"),
      ).resolves.toMatchObject({ serverConfigs: {}, servers: {}, errors: [] });
    });

    it("replaces one server with the edited form values", async () => {
      const deps = createDeps({
        custom: [
          "github",
          { ...stdioRequiredFields, optionalFields: true },
          { ...stdioOptionalFields, timeout: "90" },
        ],
      });

      await seed(deps.fileSystem, globalPath, {
        github: { command: "npx" },
        sentry: { url: "https://x.dev" },
      });

      await handleEdit(createCommandContext(deps), false, "global", deps);

      await expect(
        readMcpFile(deps.fileSystem, deps.getMcpFilePath, "global"),
      ).resolves.toMatchObject({
        servers: { github: { command: "npx", timeout: 90 } },
      });
    });

    it("preserves unknown per-server fields when editing a server", async () => {
      const deps = createDeps({
        custom: [
          "github",
          { ...stdioRequiredFields, optionalFields: true },
          { ...stdioOptionalFields, timeout: "90" },
        ],
      });
      const existingConfig = {
        command: "npx",
        args: ["-y", "github-mcp"],
        enabled: false,
        toolExposure: { search: "direct" },
        extensionMetadata: { keep: true },
      };

      await seed(deps.fileSystem, globalPath, { github: existingConfig });
      await handleEdit(createCommandContext(deps), false, "global", deps);

      const result = await deps.fileSystem.readFile(globalPath);
      expect(JSON.parse(result.success ? result.data : "{}")).toMatchObject({
        mcpServers: {
          github: {
            timeout: 90,
            enabled: false,
            toolExposure: { search: "direct" },
            extensionMetadata: { keep: true },
          },
        },
      });
    });

    it("keeps an existing oauth block when the oauth form is cancelled", async () => {
      const deps = createDeps({
        custom: [
          "sentry",
          { ...httpRequiredFields, optionalFields: true, oauthFields: true },
          httpOptionalFields,
          null,
        ],
      });
      const storedServer = {
        url: "https://mcp.sentry.dev/mcp",
        oauth: { clientId: "my-client" },
      };

      await seed(deps.fileSystem, globalPath, { sentry: storedServer });

      await handleEdit(createCommandContext(deps), false, "global", deps);

      const result = await deps.fileSystem.readFile(globalPath);
      expect(JSON.parse(result.success ? result.data : "{}")).toMatchObject({
        mcpServers: { sentry: storedServer },
      });
      expect(deps.reloads).toBe(0);
    });

    it("adds a server without oauth when the oauth form is cancelled", async () => {
      const deps = createDeps({
        custom: [
          "http",
          { ...httpRequiredFields, optionalFields: false, oauthFields: true },
          null,
        ],
      });

      await handleCreate(createCommandContext(deps), "global", deps);

      await expect(
        readMcpFile(deps.fileSystem, deps.getMcpFilePath, "global"),
      ).resolves.toMatchObject({
        servers: {
          sentry: { type: "http", url: "https://mcp.sentry.dev/mcp" },
        },
      });
    });

    it("writes nothing when the second form is cancelled", async () => {
      const deps = createDeps({
        custom: [
          "github",
          { ...stdioRequiredFields, optionalFields: true },
          null,
        ],
      });

      await seed(deps.fileSystem, globalPath, { github: { command: "npx" } });

      await handleEdit(createCommandContext(deps), false, "global", deps);

      const result = await deps.fileSystem.readFile(globalPath);
      expect(JSON.parse(result.success ? result.data : "{}")).toEqual({
        mcpServers: { github: { command: "npx" } },
      });
    });

    it("leaves the file alone when the prefilled form is cancelled", async () => {
      const deps = createDeps({ custom: ["sentry", null] });

      await seed(deps.fileSystem, globalPath, {
        sentry: { url: "https://mcp.sentry.dev/mcp", exposure: "direct" },
      });

      await handleEdit(createCommandContext(deps), false, "global", deps);

      const contents = await readMcpFile(
        deps.fileSystem,
        deps.getMcpFilePath,
        "global",
      );

      expect(contents.servers.sentry).toMatchObject({ exposure: "direct" });
    });

    it("reports when the file has no servers to edit", async () => {
      const deps = createDeps({ custom: [] });

      await seed(deps.fileSystem, globalPath, {});

      await handleEdit(createCommandContext(deps), false, "global", deps);

      expect(deps.notifications).toEqual([
        `No MCP servers found in ${globalPath}`,
      ]);
    });
  });

  describe("handleDelete", () => {
    it("removes the selected servers and keeps the rest", async () => {
      const deps = createDeps({ custom: [["github"]] });

      await seed(deps.fileSystem, globalPath, {
        github: { command: "npx" },
        sentry: { url: "https://x.dev" },
      });

      await handleDelete(createCommandContext(deps), "global", deps);

      await expect(
        readMcpFile(deps.fileSystem, deps.getMcpFilePath, "global"),
      ).resolves.toMatchObject({
        servers: { sentry: { url: "https://x.dev" } },
      });
    });

    it("writes nothing when the selection is empty", async () => {
      const deps = createDeps({ custom: [[]] });

      await seed(deps.fileSystem, globalPath, { github: { command: "npx" } });

      await handleDelete(createCommandContext(deps), "global", deps);

      await expect(
        readMcpFile(deps.fileSystem, deps.getMcpFilePath, "global"),
      ).resolves.toMatchObject({ servers: { github: { command: "npx" } } });
    });

    it("stops without writing when the file cannot be read", async () => {
      const deps = createDeps({ custom: [["github"]] });
      const existingServers = { github: { command: "npx" } };

      await seed(deps.fileSystem, globalPath, existingServers);
      vi.spyOn(deps.fileSystem, "readFile").mockResolvedValueOnce({
        success: false,
        error: new Error("permission denied"),
      });

      await handleDelete(createCommandContext(deps), "global", deps);

      const result = await deps.fileSystem.readFile(globalPath);
      expect(JSON.parse(result.success ? result.data : "{}")).toEqual({
        mcpServers: existingServers,
      });
      expect(deps.reloads).toBe(0);
    });
  });

  describe("extension entry point", () => {
    it("registers both scope commands and the boolean edit flag", () => {
      const { commands, flags } = createExtensionApi();

      expect([...commands.keys()]).toEqual([GLOBAL_COMMAND, LOCAL_COMMAND]);
      expect(flags.get(EDIT_FLAG)).toBe(false);
    });

    it("completes the subcommands each command accepts", async () => {
      const { commands } = createExtensionApi();

      for (const commandName of [GLOBAL_COMMAND, LOCAL_COMMAND]) {
        const completions = await commands
          .get(commandName)
          ?.getArgumentCompletions?.("");

        expect(completions?.map((completion) => completion.value)).toEqual([
          "create",
          "edit",
          "delete",
        ]);
      }
    });

    it("rejects an unknown subcommand without opening a form", async () => {
      const { commands } = createExtensionApi();
      const { ctx, notifications } = createSubcommandContext();

      await commands.get(GLOBAL_COMMAND)?.handler("rename", ctx);

      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toMatch(/create|edit|delete/);
    });

    it.each([
      "create",
      "delete",
    ])("rejects the edit flag with %s", async (subcommand) => {
      const { commands, flags } = createExtensionApi();
      flags.set(EDIT_FLAG, true);
      const { ctx, notifications } = createSubcommandContext();

      await commands.get(GLOBAL_COMMAND)?.handler(subcommand, ctx);

      expect(notifications).toEqual([
        `Invalid command: --${EDIT_FLAG} can only be used with edit`,
      ]);
    });
  });
});
