import baseConfig from '../../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    // The store finder's two documents, captured verbatim (plan 0106). They
    // are what the source sent and not source of ours: `data.js` is a `var`
    // assignment and `data_total.js` is a bare JSON object, so linting them
    // reports on Mercadona's coding style rather than on this library's.
    ignores: ['**/__fixtures__/*.js'],
  },
  {
    files: ['**/*.json'],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: ['{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}'],
        },
      ],
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
];
