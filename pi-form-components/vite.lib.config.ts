import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: packageRoot,
  build: {
    lib: {
      entry: path.resolve(packageRoot, "src/index.ts"),
      formats: ["es"],
      fileName: () => "index.js",
    },
    emptyOutDir: true,
    sourcemap: true,
    outDir: "dist",
    rollupOptions: {
      external: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"],
    },
  },
  plugins: [
    dts({
      entryRoot: "src",
      outDir: "dist",
      insertTypesEntry: true,
      rollupTypes: false,
      tsconfigPath: path.resolve(packageRoot, "tsconfig.lib.json"),
    }),
  ],
});
