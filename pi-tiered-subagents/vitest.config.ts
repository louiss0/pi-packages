import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "#src": path.resolve(dirname, "src"),
      "#test": path.resolve(dirname, "test"),
    },
  },
  test: {
    name: "pi-tiered-subagents",
    environment: "node",

    include: ["test/**/*.test.ts"],

    exclude: ["node_modules", "dist", ".idea", ".git"],

    globals: true,

    clearMocks: true,
    restoreMocks: true,
    mockReset: true,

    watch: false,

    // Two suites here start real processes (the SDK runtime fixture and Pi's
    // MCP client) and one spawns `git`. Unbounded worker parallelism makes
    // those checks starve and time out on a loaded machine, so the cap keeps
    // the run reproducible without serialising everything.
    maxWorkers: 2,
    testTimeout: 30_000,

    coverage: {
      provider: "v8",

      reporter: ["text", "html"],

      include: ["src/**/*.ts", "extensions/**/*.ts"],

      exclude: ["**/*.test.ts", "**/*.d.ts"],
    },
  },
});
