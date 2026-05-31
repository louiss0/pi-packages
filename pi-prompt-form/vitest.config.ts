// vitest.config.ts
    import { defineConfig } from "vitest/config";

    export default defineConfig({
      test: {
        environment: "node",

        include: ["extensions/**/*.test.ts"],

        exclude: [
          "node_modules",
          "dist",
          ".idea",
          ".git"
        ],

        globals: true,

        clearMocks: true,
        restoreMocks: true,
        mockReset: true,

        watch: false,

        coverage: {
          provider: "v8",

          reporter: ["text", "html"],

          include: ["extensions/**/*.ts"],

          exclude: [
            "extensions/**/*.test.ts",
            "extensions/**/*.d.ts"
          ]
        }
      }
    });