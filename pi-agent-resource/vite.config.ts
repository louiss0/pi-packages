import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  cacheDir: "../node_modules/.vite/pi-agent-resource",
  test: {
    name: "pi-agent-resource",
    watch: false,
    globals: true,
    environment: "node",
    include: ["extensions/**/*.test.ts", "shared/**/*.test.ts"],
    reporters: ["default"],
    coverage: {
      provider: "v8",
    },
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
