import { homedir } from "node:os";
import {
  mkdir as nodeMkdir,
  readdir as nodeReaddir,
  readFile as nodeReadFile,
  rm as nodeRm,
  writeFile as nodeWriteFile,
} from "node:fs/promises";
import { fs as memoryFs, vol } from "memfs";
import { isAbsolute, join, normalize, relative } from "node:path";

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
  rootPath: string;
  mkdir(path: string, options: { recursive: true }): Promise<ResourceResult<unknown>>;
  readDirectoryNames(path: string): Promise<ResourceResult<string[]>>;
  readDirectoryEntries(path: string): Promise<ResourceResult<ResourceDirectoryEntry[]>>;
  readFile(path: string, encoding: "utf8"): Promise<ResourceResult<string>>;
  removeDirectory(path: string): Promise<ResourceResult<void>>;
  removeFile(path: string): Promise<ResourceResult<void>>;
  writeFile(path: string, content: string): Promise<ResourceResult<void>>;
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

function resolveResourceRootPath(rootPath: string) {
  return isAbsolute(rootPath) ? normalize(rootPath) : join(homedir(), rootPath);
}

export function resolveResourcePath(fileSystem: ResourceFileSystem, path: string) {
  return join(fileSystem.rootPath, path);
}

export function getResourceRelativePath(fileSystem: ResourceFileSystem, path: string) {
  if (!isAbsolute(path)) {
    return path.replace(/^[\\/]+/, "");
  }

  return relative(fileSystem.rootPath, path);
}

export class NodeFileSystem implements ResourceFileSystem {
  #rootPath: string;

  constructor(rootPath: string) {
    this.#rootPath = resolveResourceRootPath(rootPath);
  }

  get rootPath() {
    return this.#rootPath;
  }

  mkdir(path: string, options: { recursive: true }) {
    return getResourceResult(() => nodeMkdir(join(path), options));
  }
  readDirectoryNames(path: string) {
    return getResourceResult(() => nodeReaddir(join(this.#rootPath, path)));
  }
  readDirectoryEntries(path: string) {
    return getResourceResult(() =>
      nodeReaddir(join(this.#rootPath, path), { withFileTypes: true }),
    );
  }
  readFile(path: string): Promise<ResourceResult<string>> {
    return getResourceResult(() => nodeReadFile(join(this.#rootPath, path), "utf8"));
  }
  removeDirectory(path: string) {
    return getResourceResult(() =>
      nodeRm(join(this.#rootPath, path), { force: true, recursive: true }),
    );
  }
  removeFile(path: string) {
    return getResourceResult(() => nodeRm(join(this.#rootPath, path), { force: true }));
  }
  writeFile(path: string, content: string) {
    return getResourceResult(() =>
      nodeWriteFile(join(this.#rootPath, path), content, { encoding: "utf-8" }),
    );
  }
}

export class MemoryFileSystem implements ResourceFileSystem {
  #rootPath: string;

  constructor(rootPath: string) {
    this.#rootPath = resolveResourceRootPath(rootPath);
  }

  get rootPath(): string {
    return this.#rootPath;
  }

  reset() {
    vol.reset();
  }

  seed(filesByPath: Record<string, string>) {
    vol.fromJSON(filesByPath, this.rootPath);
  }

  mkdir(path: string, options: { recursive: true }): Promise<ResourceResult<unknown>> {
    return getResourceResult(() =>
      memoryFs.promises.mkdir(join(this.#rootPath, path), options),
    );
  }
  readDirectoryNames(path: string): Promise<ResourceResult<string[]>> {
    return getResourceResult(async () => {
      const names = await memoryFs.promises.readdir(join(this.#rootPath, path), {
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
      const entries = await memoryFs.promises.readdir(join(this.#rootPath, path), {
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
      const content = await memoryFs.promises.readFile(join(this.#rootPath, path), {
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
      memoryFs.promises.rm(join(this.#rootPath, path), { force: true, recursive: true }),
    );
  }
  removeFile(path: string): Promise<ResourceResult<void>> {
    return getResourceResult(() =>
      memoryFs.promises.rm(join(this.#rootPath, path), { force: true }),
    );
  }
  writeFile(path: string, content: string): Promise<ResourceResult<void>> {
    return getResourceResult(() =>
      memoryFs.promises.writeFile(join(this.#rootPath, path), content, { encoding: "utf8" }),
    );
  }
}

export function getNodeResourceFileSystem(rootPath: string) {
  return new NodeFileSystem(rootPath);
}

export function getMemoryResourceFileSystem(rootPath: string) {
  return new MemoryFileSystem(rootPath);
}
