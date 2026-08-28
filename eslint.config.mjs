import nx from '@nx/eslint-plugin';

export default [
  {
    files: ['**/*.json'],
    // Override or add rules here
    rules: {},
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [
            '^.*/eslint(\\.base)?\\.config\\.[cm]?js$',
            // The module federation share rule, imported by the shell's and every
            // remote's `module-federation.config.ts`. Build configuration rather than
            // application code: it never reaches a bundle, and it has to be one file
            // precisely because a `shared` callback governs only its own build, so the
            // rule means nothing unless all six configs say the same thing. The
            // boundary this rule protects is between apps, and this crosses no such
            // boundary.
            // Matched as the import is written, extensionless, the same way the
            // eslint entry above is.
            '^.*/module-federation\\.shared$',
            // The shared Playwright reporter helper, imported by every e2e suite's
            // `playwright.config.ts`. Test runner configuration rather than
            // application code: it never reaches a bundle and no spec imports it. It
            // is one file at the workspace root for the same reason as the entry
            // above, that a suite whose reporters disagree with the others produces a
            // CI log nobody can read, so the decision belongs in one place.
            // Matched as the import is written, extensionless, the same way the
            // entries above are.
            '^.*/playwright\\.reporters$',
          ],
          depConstraints: [
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {
      // Honor the `_`-prefix convention for intentionally unused bindings.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['*.html'],
    excludedFiles: ['*inline-template-*.component.html'],
    extends: [
      'plugin:@angular-eslint/template/recommended',
      'plugin:prettier/recommended',
    ],
    rules: {
      'prettier/prettier': ['error', { parser: 'angular' }],
    },
  },
];
