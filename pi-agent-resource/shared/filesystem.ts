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

export type ResourceWriteFileOptions =
	| "utf8"
	| { encoding: "utf8"; flag: "wx" };

export type ResourceFileSystem = {
	mkdir(path: string, options: { recursive: true }): Promise<unknown>;
	readDirectoryNames(path: string): Promise<string[]>;
	readDirectoryEntries(path: string): Promise<ResourceDirectoryEntry[]>;
	readFile(path: string, encoding: "utf8"): Promise<string>;
	removeDirectory(path: string): Promise<void>;
	removeFile(path: string): Promise<void>;
	writeFile(
		path: string,
		content: string,
		options: ResourceWriteFileOptions,
	): Promise<void>;
};

let configuredFileSystem: ResourceFileSystem | undefined;

const nodeFileSystem: ResourceFileSystem = {
	mkdir(path, options) {
		return nodeMkdir(path, options);
	},
	readDirectoryNames(path) {
		return nodeReaddir(path) as Promise<string[]>;
	},
	readDirectoryEntries(path) {
		return nodeReaddir(path, { withFileTypes: true }) as Promise<
			ResourceDirectoryEntry[]
		>;
	},
	readFile(path, encoding) {
		return nodeReadFile(path, encoding);
	},
	removeDirectory(path) {
		return nodeRm(path, { force: true, recursive: true });
	},
	removeFile(path) {
		return nodeRm(path, { force: true });
	},
	writeFile(path, content, options) {
		return nodeWriteFile(path, content, options);
	},
};

function toMemoryWriteFileOptions(options: ResourceWriteFileOptions) {
	if (typeof options === "string") {
		return { encoding: options };
	}

	return options;
}

const memoryFileSystem: ResourceFileSystem = {
	mkdir(path, options) {
		return memoryFs.promises.mkdir(path, options);
	},
	readDirectoryNames(path) {
		return memoryFs.promises.readdir(path) as Promise<string[]>;
	},
	readDirectoryEntries(path) {
		return memoryFs.promises.readdir(path, { withFileTypes: true }) as Promise<
			ResourceDirectoryEntry[]
		>;
	},
	readFile(path, encoding) {
		return memoryFs.promises.readFile(path, encoding) as Promise<string>;
	},
	removeDirectory(path) {
		return memoryFs.promises.rm(path, { force: true, recursive: true });
	},
	removeFile(path) {
		return memoryFs.promises.rm(path, { force: true });
	},
	writeFile(path, content, options) {
		return memoryFs.promises.writeFile(
			path,
			content,
			toMemoryWriteFileOptions(options),
		);
	},
};

export function getResourceFileSystem() {
	if (configuredFileSystem) {
		return configuredFileSystem;
	}

	if (isDevelopmentExtensionRuntime()) {
		return memoryFileSystem;
	}

	return nodeFileSystem;
}

export function useMemoryResourceFileSystem() {
	configuredFileSystem = memoryFileSystem;
	vol.reset();
	return memoryFileSystem;
}

export function seedMemoryResourceFileSystem(
	filesByPath: Record<string, string>,
) {
	vol.fromJSON(filesByPath, "/");
}

export function resetResourceFileSystem() {
	configuredFileSystem = undefined;
	vol.reset();
}
