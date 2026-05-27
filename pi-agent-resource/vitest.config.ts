import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    name: "pi-agent-resource",
    watch: false,
    globals: true,
    environment: "node",
    include: ["extensions/**/*.test.ts", "shared/**/*.test.ts"],
    reporters: ["default"],
  },
  resolve: {
    alias: {
      "@code-fixer-23/pi-form-components": path.resolve(
        __dirname,
        "../pi-form-components/src/index.ts",
      ),
    },
  },
});
