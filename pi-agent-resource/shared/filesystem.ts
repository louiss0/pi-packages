import {
  mkdir as nodeMkdir,
  readdir as nodeReaddir,
  readFile as nodeReadFile,
  rm as nodeRm,
  writeFile as nodeWriteFile,
} from "node:fs/promises";
import { fs as memoryFs, vol } from "memfs";
import { isDevelopmentExtensionRuntime } from "./runtime";

export type ResourceDirectoryEntry = {
  name: string;
  isDirectory(): boolean;
};

export type ResourceWriteFileOptions = "utf8" | { encoding: "utf8"; flag: "wx" };

export interface ResourceFileSystem {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  readDirectoryNames(path: string): Promise<string[]>;
  readDirectoryEntries(path: string): Promise<ResourceDirectoryEntry[]>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  removeDirectory(path: string): Promise<void>;
  removeFile(path: string): Promise<void>;
  writeFile(path: string, content: string, options: ResourceWriteFileOptions): Promise<void>;
}

let configuredFileSystem: ResourceFileSystem | undefined;
let memoryFileSystem: MemoryFileSystem | undefined;

export class NodeFileSystem implements ResourceFileSystem {
  mkdir(path: string, options: { recursive: true }) {
    return nodeMkdir(path, options);
  }
  readDirectoryNames(path: string) {
    return nodeReaddir(path);
  }
  readDirectoryEntries(path: string) {
    return nodeReaddir(path, { withFileTypes: true });
  }
  readFile(path: string, encoding: "utf8"): Promise<string> {
    return nodeReadFile(path, encoding);
  }
  removeDirectory(path: string) {
    return nodeRm(path, { force: true, recursive: true });
  }
  removeFile(path: string) {
    return nodeRm(path, { force: true });
  }
  writeFile(path: string, content: string) {
    return nodeWriteFile(path, content, { encoding: "utf-8" });
  }
}

export class MemoryFileSystem implements ResourceFileSystem {
  reset() {
    vol.reset();
  }

  seed(filesByPath: Record<string, string>) {
    vol.fromJSON(filesByPath, "/");
  }

  mkdir(path: string, options: { recursive: true }): Promise<unknown> {
    return memoryFs.promises.mkdir(path, options);
  }
  async readDirectoryNames(path: string): Promise<string[]> {
    const names = await memoryFs.promises.readdir(path, { encoding: "utf8" });

    return names.map((name) => {
      if (typeof name === "string") {
        return name;
      }

      return name.toString();
    });
  }
  async readDirectoryEntries(path: string): Promise<ResourceDirectoryEntry[]> {
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
  }
  async readFile(path: string, encoding: "utf8"): Promise<string> {
    const content = await memoryFs.promises.readFile(path, { encoding: "utf8" });

    if (typeof content === "string") {
      return content;
    }

    return content.toString(encoding);
  }
  removeDirectory(path: string): Promise<void> {
    return memoryFs.promises.rm(path, { force: true, recursive: true });
  }
  removeFile(path: string): Promise<void> {
    return memoryFs.promises.rm(path, { force: true });
  }
  writeFile(path: string, content: string): Promise<void> {
    return memoryFs.promises.writeFile(path, content, { encoding: "utf8" });
  }
}

export function getResourceFileSystem() {
  if (configuredFileSystem) {
    return configuredFileSystem;
  }

  if (isDevelopmentExtensionRuntime()) {
    memoryFileSystem ??= new MemoryFileSystem();
    return memoryFileSystem;
  }

  return new NodeFileSystem();
}

export function useMemoryResourceFileSystem() {
  memoryFileSystem ??= new MemoryFileSystem();
  configuredFileSystem = memoryFileSystem;
  memoryFileSystem.reset();
  return memoryFileSystem;
}

export function resetResourceFileSystem() {
  configuredFileSystem = undefined;
  memoryFileSystem?.reset();
}
