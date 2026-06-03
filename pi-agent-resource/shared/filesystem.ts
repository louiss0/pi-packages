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
  mkdir(path: string, options: { recursive: true }): Promise<unknown> {
    return nodeMkdir(path, options);
  }
  readDirectoryNames(path: string): Promise<string[]> {
    return nodeReaddir(path) as Promise<string[]>;
  }
  readDirectoryEntries(path: string): Promise<ResourceDirectoryEntry[]> {
    return nodeReaddir(path, { withFileTypes: true }) as Promise<ResourceDirectoryEntry[]>;
  }
  readFile(path: string, encoding: "utf8"): Promise<string> {
    return nodeReadFile(path, encoding);
  }
  removeDirectory(path: string): Promise<void> {
    return nodeRm(path, { force: true, recursive: true });
  }
  removeFile(path: string): Promise<void> {
    return nodeRm(path, { force: true });
  }
  writeFile(path: string, content: string, options: ResourceWriteFileOptions): Promise<void> {
    return nodeWriteFile(path, content, options);
  }
}

function toMemoryWriteFileOptions(options: ResourceWriteFileOptions) {
  if (typeof options === "string") {
    return { encoding: options };
  }

  return options;
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
  readDirectoryNames(path: string): Promise<string[]> {
    return memoryFs.promises.readdir(path) as Promise<string[]>;
  }
  readDirectoryEntries(path: string): Promise<ResourceDirectoryEntry[]> {
    return memoryFs.promises.readdir(path, { withFileTypes: true }) as Promise<
      ResourceDirectoryEntry[]
    >;
  }
  readFile(path: string, encoding: "utf8"): Promise<string> {
    return memoryFs.promises.readFile(path, encoding) as Promise<string>;
  }
  removeDirectory(path: string): Promise<void> {
    return memoryFs.promises.rm(path, { force: true, recursive: true });
  }
  removeFile(path: string): Promise<void> {
    return memoryFs.promises.rm(path, { force: true });
  }
  writeFile(path: string, content: string, options: ResourceWriteFileOptions): Promise<void> {
    return memoryFs.promises.writeFile(path, content, toMemoryWriteFileOptions(options));
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
