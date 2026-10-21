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

    include: ["test/**/*.test.ts", "extensions/**/*.test.ts"],

    exclude: ["node_modules", "dist", ".idea", ".git"],

    globals: true,

    clearMocks: true,
    restoreMocks: true,
    mockReset: true,

    watch: false,

    coverage: {
      provider: "v8",

      reporter: ["text", "html"],

      include: ["src/**/*.ts", "extensions/**/*.ts"],

      exclude: ["**/*.test.ts", "**/*.d.ts"],
    },
  },
});
