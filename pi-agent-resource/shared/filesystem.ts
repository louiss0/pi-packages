import {
  mkdir as nodeMkdir,
  readdir as nodeReaddir,
  readFile as nodeReadFile,
  rm as nodeRm,
  writeFile as nodeWriteFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fs as memoryFs, vol } from "memfs";

export type ResourceDirectoryEntry = {
  name: string;
  isDirectory(): boolean;
};

export type ResourceResult<T> =
  | {
      error: Error;
      success: false;
    }
  | {
      data: T;
      success: true;
    };

export interface ResourceFileSystem {
  mkdir(path: string, options: { recursive: true }): Promise<ResourceResult<unknown>>;
  readDirectoryNames(path: string): Promise<ResourceResult<string[]>>;
  readDirectoryEntries(path: string): Promise<ResourceResult<ResourceDirectoryEntry[]>>;
  readFile(path: string): Promise<ResourceResult<string>>;
  removeDirectory(path: string): Promise<ResourceResult<void>>;
  removeFile(path: string): Promise<ResourceResult<void>>;
  writeFile(path: string, content: string): Promise<ResourceResult<void>>;
}

export class PathResolver {
  #cwd: string;
  #homePath: string;

  #skillFolder = "skills";
  #agentFolder = "agents";
  #promptFolder = "prompts";

  constructor(cwd = process.cwd(), homePath = homedir()) {
    this.#cwd = cwd;
    this.#homePath = homePath;
  }

  resolvePackPath(path = "") {
    return this.#resolvePath(join(this.#homePath, ".pi", "packs"), path);
  }

  resolvePackSkillPath(packName: string, path = "") {
    return this.#resolvePackResourcePath(packName, this.#skillFolder, path);
  }

  resolvePackAgentPath(packName: string, path = "") {
    return this.#resolvePackResourcePath(packName, this.#agentFolder, path);
  }

  resolvePackPromptPath(packName: string, path = "") {
    return this.#resolvePackResourcePath(packName, this.#promptFolder, path);
  }

  resolveGlobalSkillPath(path = "") {
    return this.#resolveGlobalResourcePath(this.#skillFolder, path);
  }

  resolveLocalSkillPath(path = "") {
    return this.#resolveLocalResourcePath(this.#skillFolder, path);
  }

  resolveGlobalAgentPath(path = "") {
    return this.#resolveGlobalResourcePath(this.#agentFolder, path);
  }

  resolveLocalAgentPath(path = "") {
    return this.#resolveLocalResourcePath(this.#agentFolder, path);
  }

  resolveGlobalPromptPath(path = "") {
    return this.#resolveGlobalResourcePath(this.#promptFolder, path);
  }

  resolveLocalPromptPath(path = "") {
    return this.#resolveLocalResourcePath(this.#promptFolder, path);
  }

  #resolveGlobalResourcePath(resourceFolder: string, path: string) {
    return this.#resolvePath(join(this.#homePath, ".pi", "agent", resourceFolder), path);
  }

  #resolveLocalResourcePath(resourceFolder: string, path: string) {
    return this.#resolvePath(join(this.#cwd, ".pi", resourceFolder), path);
  }

  #resolvePackResourcePath(packName: string, resourceFolder: string, path: string) {
    return this.#resolvePath(this.resolvePackPath(join(packName, resourceFolder)), path);
  }

  #resolvePath(rootPath: string, path: string) {
    return join(rootPath, path);
  }
}

async function getResourceResult<T>(action: () => Promise<T>): Promise<ResourceResult<T>> {
  try {
    return {
      data: await action(),
      success: true,
    };
  } catch (error) {
    return {
      error: getResourceError(error),
      success: false,
    };
  }
}

function getResourceError(error: unknown) {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

export class NodeFileSystem implements ResourceFileSystem {
  mkdir(path: string, options: { recursive: true }) {
    return getResourceResult(() => nodeMkdir(join(path), options));
  }
  readDirectoryNames(path: string) {
    return getResourceResult(() => nodeReaddir(path));
  }
  readDirectoryEntries(path: string) {
    return getResourceResult(() => nodeReaddir(path, { withFileTypes: true }));
  }
  readFile(path: string): Promise<ResourceResult<string>> {
    return getResourceResult(() => nodeReadFile(path, "utf8"));
  }
  removeDirectory(path: string) {
    return getResourceResult(() => nodeRm(path, { force: true, recursive: true }));
  }
  removeFile(path: string) {
    return getResourceResult(() => nodeRm(path, { force: true }));
  }
  writeFile(path: string, content: string) {
    return getResourceResult(() => nodeWriteFile(path, content, { encoding: "utf-8" }));
  }
}

export class MemoryFileSystem implements ResourceFileSystem {
  reset() {
    vol.reset();
  }

  seed(filesByPath: Record<string, string>) {
    vol.fromJSON(filesByPath);
  }

  mkdir(path: string, options: { recursive: true }): Promise<ResourceResult<unknown>> {
    return getResourceResult(() => memoryFs.promises.mkdir(path, options));
  }
  readDirectoryNames(path: string): Promise<ResourceResult<string[]>> {
    return getResourceResult(async () => {
      const names = await memoryFs.promises.readdir(path, {
        encoding: "utf8",
      });

      return names.map((name) => {
        if (typeof name === "string") {
          return name;
        }

        return name.toString();
      });
    });
  }
  readDirectoryEntries(path: string): Promise<ResourceResult<ResourceDirectoryEntry[]>> {
    return getResourceResult(async () => {
      const entries = await memoryFs.promises.readdir(path, {
        withFileTypes: true,
      });
      const directoryEntries: ResourceDirectoryEntry[] = [];

      return entries.reduce((directoryEntries, entry) => {
        if (typeof entry === "string" || Buffer.isBuffer(entry)) {
          return directoryEntries;
        }

        directoryEntries.push({
          name: entry.name.toString(),
          isDirectory: () => entry.isDirectory(),
        });

        return directoryEntries;
      }, directoryEntries);
    });
  }
  readFile(path: string): Promise<ResourceResult<string>> {
    return getResourceResult(async () => {
      const content = await memoryFs.promises.readFile(path, {
        encoding: "utf8",
      });

      if (typeof content === "string") {
        return content;
      }

      return content.toString("utf-8");
    });
  }
  removeDirectory(path: string): Promise<ResourceResult<void>> {
    return getResourceResult(() =>
      memoryFs.promises.rm(path, { force: true, recursive: true }),
    );
  }
  removeFile(path: string): Promise<ResourceResult<void>> {
    return getResourceResult(() => memoryFs.promises.rm(path, { force: true }));
  }
  writeFile(path: string, content: string): Promise<ResourceResult<void>> {
    return getResourceResult(() =>
      memoryFs.promises.writeFile(path, content, { encoding: "utf8" }),
    );
  }
}

export function getPathResolver(cwd = process.cwd()) {
  return new PathResolver(cwd);
}
