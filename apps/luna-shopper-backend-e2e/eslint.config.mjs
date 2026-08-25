import playwright from 'eslint-plugin-playwright';
import baseConfig from '../../eslint.config.mjs';

export default [
  playwright.configs['flat/recommended'],
  ...baseConfig,
  {
    files: ['**/*.ts', '**/*.js'],
    rules: {
      // The suite skips itself when the backend stack is not reachable (an
      // infra gate, plan 0010), which is a deliberate conditional skip.
      'playwright/no-skipped-test': ['error', { allowConditional: true }],
    },
  },
];
