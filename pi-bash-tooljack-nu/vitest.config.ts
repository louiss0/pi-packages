import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "pi-bash-tooljack-nu",
    watch: false,
    globals: true,
    environment: "node",
    passWithNoTests: true,
    include: ["src/**/*.{test,spec}.ts"],
    reporters: ["default"],
    coverage: {
      reportsDirectory: "./test-output/vitest/coverage",
      provider: "v8" as const,
    },
  },
});
