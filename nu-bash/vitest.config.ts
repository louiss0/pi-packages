import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@code-fixer-23/nu-bash',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
});
