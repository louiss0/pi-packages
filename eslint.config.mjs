import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/build',
      '**/vite.config.*.timestamp*',
      '**/vitest.config.*.timestamp*',
    ],
  },
  {
    files: ['**/*.ts', '**/*.js'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            {
              sourceTag: 'project:package',
              notDependOnLibsWithTags: ['project:extension'],
            },
            {
              sourceTag: 'project:extension',
              notDependOnLibsWithTags: ['project:extension'],
            },
            {
              sourceTag: 'status:supported',
              onlyDependOnLibsWithTags: ['status:supported'],
            },
            {
              sourceTag: 'status:deprecated',
              onlyDependOnLibsWithTags: ['status:supported', 'status:deprecated'],
            },
            {
              sourceTag: 'scope:shared',
              onlyDependOnLibsWithTags: ['scope:shared'],
            },
            {
              sourceTag: 'scope:async',
              onlyDependOnLibsWithTags: ['scope:shared', 'scope:async'],
            },
            {
              sourceTag: 'scope:colors',
              onlyDependOnLibsWithTags: ['scope:shared', 'scope:colors'],
            },
            {
              sourceTag: 'scope:strings',
              onlyDependOnLibsWithTags: ['scope:shared', 'scope:strings'],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.cjs',
      '**/*.mjs',
    ],
    rules: {},
  },
  {
    // pi-tiered-subagents carries a runtime recovered from an upstream project
    // that deliberately relaxed these rules for its own tree: the Pi SDK types
    // are `Model<any>`-shaped, its `Component` implementations have empty
    // `invalidate()` bodies by contract, and its test doubles are empty on
    // purpose. The rules come back as the specified work replaces the
    // inherited code.
    files: ['pi-tiered-subagents/**/*.ts'],
    rules: {
      '@typescript-eslint/no-empty-function': [
        'error',
        { allow: ['arrowFunctions', 'functions', 'methods'] },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // A leading underscore marks a parameter the interface requires but the
      // implementation does not use.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-control-regex': 'off',
    },
  },
];
