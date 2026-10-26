/**
 * A real stdio MCP server for the resource-only integration check.
 *
 * It speaks newline-delimited JSON-RPC, announces resources (and no tools
 * beyond the empty list), and answers a read with fixed text. Nothing here
 * touches the network or the model.
 */
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const RESOURCE_URI = "fixture://greeting";
/** Optional diagnostic log: the resource test passes a path to explain failures. */
const logPath = process.argv[2];

function trace(entry) {
  if (!logPath) return;
  try {
    appendFileSync(
      logPath,
      `${entry}
`,
    );
  } catch {
    // Diagnostics must never break the server.
  }
}

trace("started");

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id, value) {
  send({ jsonrpc: "2.0", id, result: value });
}

function failure(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

const lines = createInterface({ input: process.stdin });

lines.on("line", (line) => {
  if (line.trim() === "") return;
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = request;
  trace(`request ${String(method)}`);
  // Notifications carry no id and take no response.
  if (id === undefined) return;

  switch (method) {
    case "initialize":
      result(id, {
        protocolVersion: params?.protocolVersion ?? "2025-06-18",
        capabilities: { resources: { listChanged: false }, tools: {} },
        serverInfo: { name: "fixture-resource-server", version: "1.0.0" },
      });
      return;
    case "ping":
      result(id, {});
      return;
    case "tools/list":
      result(id, { tools: [] });
      return;
    case "resources/list":
      result(id, {
        resources: [
          {
            uri: RESOURCE_URI,
            name: "greeting",
            description: "A fixed fixture resource",
            mimeType: "text/plain",
          },
        ],
      });
      return;
    case "resources/templates/list":
      result(id, { resourceTemplates: [] });
      return;
    case "resources/read":
      if (params?.uri !== RESOURCE_URI) {
        failure(id, -32602, `unknown resource: ${String(params?.uri)}`);
        return;
      }
      result(id, {
        contents: [
          {
            uri: RESOURCE_URI,
            mimeType: "text/plain",
            text: "hello from the fixture resource",
          },
        ],
      });
      return;
    default:
      failure(id, -32601, `unsupported method: ${String(method)}`);
  }
});

lines.on("close", () => {
  process.exit(0);
});
