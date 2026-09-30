import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ExtensionCommandContext,
  McpServerConfig,
} from "@earendil-works/pi-coding-agent";

import {
  MemoryFileSystem,
  type ResourceFileSystem,
} from "../shared/filesystem";
import {
  createMcpFilePathResolver,
  handleCreate,
  handleDelete,
  handleEdit,
  parseHttpServerFormValues,
  parseMcpServerConfig,
  parseOAuthFormValues,
  parseStdioServerFormValues,
  readMcpFile,
  renderHttpServerConfig,
  renderStdioServerConfig,
  toMcpOAuthFields,
  toMcpServerFields,
  writeMcpFile,
  type McpCraftDeps,
  type StdioServerFields,
} from "./mcp-craft";

const workspace = "/workspace";
const home = "/test-home";

const globalPath = join(home, ".pi", "agent", "mcp.json");
const localPath = join(workspace, ".pi", "mcp.json");

const stdioFields = {
  name: "github",
  command: "npx",
  args: "-y, github-mcp",
  env: "GITHUB_TOKEN=${GITHUB_TOKEN}",
  cwd: "",
  exposure: "direct",
  timeout: "30",
};

const httpFields = {
  name: "sentry",
  url: "https://mcp.sentry.dev/mcp",
  headers: "Authorization=Bearer ${SENTRY_TOKEN}",
  exposure: "",
  timeout: "",
  confirm: false,
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
        error: 'invalid server name "my server" (use letters, digits, "_" and "-")',
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
      ).resolves.toEqual({ file: {}, serverConfigs: {}, servers: {}, errors: [] });
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
    it("accepts a complete stdio entry", () => {
      expect(parseStdioServerFormValues(stdioFields)).toBeUndefined();
    });

    it("rejects stdio env that is not KEY=VALUE pairs", () => {
      expect(
        parseStdioServerFormValues({ ...stdioFields, env: "GITHUB_TOKEN" }),
      ).toMatchObject({ env: expect.any(Array) });
    });

    it("rejects a timeout that is not a positive number of seconds", () => {
      expect(
        parseStdioServerFormValues({ ...stdioFields, timeout: "-5" }),
      ).toMatchObject({ timeout: expect.any(Array) });
    });

    it("rejects an exposure pi does not have", () => {
      expect(
        parseStdioServerFormValues({ ...stdioFields, exposure: "sometimes" }),
      ).toMatchObject({ exposure: expect.any(Array) });
    });

    it("accepts an http entry with none of the stdio fields", () => {
      expect(parseHttpServerFormValues(httpFields)).toBeUndefined();
    });

    it("rejects a url that is not http or https", () => {
      expect(
        parseHttpServerFormValues({ ...httpFields, url: "ftp://example.com" }),
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
      expect(renderStdioServerConfig(stdioFields)).toEqual({
        type: "stdio",
        command: "npx",
        args: ["-y", "github-mcp"],
        env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
        exposure: "direct",
        timeout: 30,
      });
    });

    it("writes only the fields an http server has", () => {
      expect(renderHttpServerConfig(httpFields)).toEqual({
        type: "http",
        url: "https://mcp.sentry.dev/mcp",
        headers: { Authorization: "Bearer ${SENTRY_TOKEN}" },
      });
    });

    it("adds oauth only when the second form was filled in", () => {
      expect(renderHttpServerConfig(httpFields, oauthFields)).toMatchObject({
        oauth: {
          clientId: "my-client",
          clientSecret: "${CLIENT_SECRET}",
          scope: "read write",
          callbackPort: 8765,
        },
      });
    });

    it("leaves server activity settings to Pi", () => {
      expect(renderStdioServerConfig(stdioFields)).not.toHaveProperty("enabled");
      expect(renderHttpServerConfig(httpFields)).not.toHaveProperty("enabled");
    });
  });

  describe("toMcpServerFields", () => {
    it("maps a stored stdio server back onto the form fields", () => {
      expect(
        toMcpServerFields("github", {
          type: "stdio",
          command: "npx",
          args: ["-y", "github-mcp"],
          env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
          exposure: "direct",
          timeout: 30,
        }),
      ).toEqual({
        name: "github",
        command: "npx",
        args: "-y, github-mcp",
        env: "GITHUB_TOKEN=${GITHUB_TOKEN}",
        cwd: "",
        exposure: "direct",
        timeout: "30",
      });
    });

    it("maps a stored http server back onto the form fields", () => {
      expect(
        toMcpServerFields("sentry", {
          type: "http",
          url: "https://mcp.sentry.dev/mcp",
          headers: { Authorization: "Bearer ${SENTRY_TOKEN}" },
          enabled: false,
        }),
      ).toEqual({
        name: "sentry",
        url: "https://mcp.sentry.dev/mcp",
        headers: "Authorization=Bearer ${SENTRY_TOKEN}",
        exposure: "",
        timeout: "",
        confirm: false,
      });
    });

    it("asks for oauth again when the stored server has it", () => {
      expect(
        toMcpServerFields("sentry", {
          type: "http",
          url: "https://mcp.sentry.dev/mcp",
          oauth: { clientId: "my-client" },
        }),
      ).toMatchObject({ confirm: true });
    });

    it("round trips a config through the form fields", () => {
      const config: McpServerConfig = {
        type: "stdio",
        command: "npx",
        args: ["-y", "github-mcp"],
        env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
        exposure: "direct",
        timeout: 30,
      };

      expect(
        renderStdioServerConfig(
          toMcpServerFields("github", config) as StdioServerFields,
        ),
      ).toEqual(config);
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
      const deps = createDeps({ custom: ["stdio", stdioFields] });

      await handleCreate(createCommandContext(deps), "global", deps);

      await expect(
        readMcpFile(deps.fileSystem, deps.getMcpFilePath, "global"),
      ).resolves.toMatchObject({
        servers: { github: { type: "stdio", command: "npx" } },
      });
      expect(deps.reloads).toBe(1);
    });

    it("adds an http server with oauth to the project file", async () => {
      const deps = createDeps({
        custom: ["http", { ...httpFields, confirm: true }, oauthFields],
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

    it("keeps the servers already in the file", async () => {
      const deps = createDeps({ custom: ["stdio", stdioFields] });

      await seed(deps.fileSystem, globalPath, { sentry: { url: "https://x.dev" } });

      await handleCreate(createCommandContext(deps), "global", deps);

      const contents = await readMcpFile(
        deps.fileSystem,
        deps.getMcpFilePath,
        "global",
      );

      expect(Object.keys(contents.servers)).toEqual(["sentry", "github"]);
    });

    it("does not overwrite an invalid MCP file", async () => {
      const deps = createDeps({ custom: ["stdio", stdioFields] });
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

      await expect(
        deps.fileSystem.readFile(globalPath),
      ).resolves.toMatchObject({ success: false });
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
        custom: ["github", { ...stdioFields, timeout: "90" }],
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
        custom: ["github", { ...stdioFields, timeout: "90" }],
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
      ).resolves.toMatchObject({ servers: { sentry: { url: "https://x.dev" } } });
    });

    it("writes nothing when the selection is empty", async () => {
      const deps = createDeps({ custom: [[]] });

      await seed(deps.fileSystem, globalPath, { github: { command: "npx" } });

      await handleDelete(createCommandContext(deps), "global", deps);

      await expect(
        readMcpFile(deps.fileSystem, deps.getMcpFilePath, "global"),
      ).resolves.toMatchObject({ servers: { github: { command: "npx" } } });
    });
  });
});
