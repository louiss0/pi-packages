import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

const external = [
  '@mariozechner/pi-coding-agent',
  '@mariozechner/pi-tui',
  '@sinclair/typebox',
  'node:child_process',
];

export default defineConfig({
  root: packageRoot,
  build: {
    lib: {
      entry: path.resolve(packageRoot, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'index',
    },
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      external,
    },
  },
  plugins: [
    dts({
      entryRoot: 'src',
      outDir: 'dist',
      insertTypesEntry: true,
      rollupTypes: false,
      tsconfigPath: path.resolve(packageRoot, 'tsconfig.lib.json'),
    }),
  ],
  test: {
    name: '@org/nu-bash',
    watch: false,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8',
    },
  },
});
