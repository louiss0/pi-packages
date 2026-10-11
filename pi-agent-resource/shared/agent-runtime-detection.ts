import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentRuntime } from "./agent-contracts";

/** Public local abstraction: do not export SDK class types across package boundaries. */
export interface AgentResourceSource {
  sourceInfo?: { path: string; source: string; baseDir?: string };
}

type ReadManifest = (path: string) => Promise<string>;

function runtimeFromManifest(content: string): AgentRuntime | undefined {
  const manifest: unknown = JSON.parse(content);
  if (!manifest || typeof manifest !== "object") return undefined;
  const value = manifest as { name?: unknown; repository?: unknown };
  const repository = typeof value.repository === "string" ? value.repository :
    value.repository && typeof value.repository === "object" ? (value.repository as { url?: unknown }).url : undefined;
  if (typeof repository !== "string") return undefined;
  const url = repository.replace(/^git\+/, "").replace(/\.git$/, "").replace(/\/$/, "");
  if (value.name === "@tintinweb/pi-subagents" && url === "https://github.com/tintinweb/pi-subagents") return "tintin";
  if (value.name === "pi-subagents" && url === "https://github.com/nicobailon/pi-subagents") return "nico";
  return undefined;
}

/** Registry provenance plus a passive manifest read; never execute extension code. */
export async function detectAgentRuntimes(
  sources: readonly AgentResourceSource[],
  readManifest: ReadManifest = (path) => readFile(path, "utf8"),
): Promise<AgentRuntime[]> {
  const found = new Set<AgentRuntime>();
  const visited = new Set<string>();
  for (const { sourceInfo } of sources) {
    if (!sourceInfo || !sourceInfo.path || /^(?:builtin:|<)/.test(sourceInfo.path)) continue;
    for (const startingDirectory of [sourceInfo.baseDir, dirname(sourceInfo.path)]) {
      if (!startingDirectory) continue;
      let directory = startingDirectory;
      for (let depth = 0; depth < 16; depth++) {
        if (visited.has(directory)) break;
        visited.add(directory);
        try {
          const runtime = runtimeFromManifest(await readManifest(join(directory, "package.json")));
          if (runtime) found.add(runtime);
          // The nearest package boundary owns the resource. Names alone are not evidence.
          break;
        } catch {
          // Unreadable metadata is ambiguous, not permission to infer from tool names.
        }
        const parent = dirname(directory);
        if (parent === directory) break;
        directory = parent;
      }
    }
  }
  return [...found].sort();
}
