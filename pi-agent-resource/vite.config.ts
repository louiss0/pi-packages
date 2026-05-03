import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true, // Allows using 'describe', 'it', etc. without importing them
    environment: "node", // Use 'jsdom' or 'happy-dom' for browser-like environments

    coverage: {
      provider: "v8", // or 'istanbul'
    },
  },
});
