import {
  mkdir as nodeMkdir,
  readdir as nodeReaddir,
  readFile as nodeReadFile,
  rm as nodeRm,
  writeFile as nodeWriteFile,
} from "node:fs/promises";
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

export class NodeFileSystem implements ResourceFileSystem {
  mkdir(path: string, options: { recursive: true }) {
    return getResourceResult(() => nodeMkdir(path, options));
  }
  readDirectoryNames(path: string) {
    return getResourceResult(() => nodeReaddir(path));
  }
  readDirectoryEntries(path: string) {
    return getResourceResult(() => nodeReaddir(path, { withFileTypes: true }));
  }
  readFile(path: string, encoding: "utf8"): Promise<ResourceResult<string>> {
    return getResourceResult(() => nodeReadFile(path, encoding));
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
    vol.fromJSON(filesByPath, "/");
  }

  mkdir(path: string, options: { recursive: true }): Promise<ResourceResult<unknown>> {
    return getResourceResult(() => memoryFs.promises.mkdir(path, options));
  }
  readDirectoryNames(path: string): Promise<ResourceResult<string[]>> {
    return getResourceResult(async () => {
      const names = await memoryFs.promises.readdir(path, { encoding: "utf8" });

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
      const entries = await memoryFs.promises.readdir(path, { withFileTypes: true });
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
  readFile(path: string, encoding: "utf8"): Promise<ResourceResult<string>> {
    return getResourceResult(async () => {
      const content = await memoryFs.promises.readFile(path, { encoding: "utf8" });

      if (typeof content === "string") {
        return content;
      }

      return content.toString(encoding);
    });
  }
  removeDirectory(path: string): Promise<ResourceResult<void>> {
    return getResourceResult(() => memoryFs.promises.rm(path, { force: true, recursive: true }));
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

export function getNodeResourceFileSystem() {
  return new NodeFileSystem();
}

export function getMemoryResourceFileSystem() {
  return new MemoryFileSystem();
}
