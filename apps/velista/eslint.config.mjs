import nx from '@nx/eslint-plugin';
import baseConfig from '../../eslint.config.mjs';

export default [
  ...nx.configs['flat/angular'],
  ...nx.configs['flat/angular-template'],
  ...baseConfig,
  {
    // Design mocks are standalone HTML documents published as a canvas (see
    // plans/mocks/README.md), not Angular templates. Linting them with
    // @angular-eslint/template asserts rules that do not apply — a `<label>` in a
    // mock has no form element to associate with because there is no form, only a
    // picture of one — and `plans/mocks/list` fails on exactly that.
    ignores: ['**/plans/mocks/**'],
  },
  {
    // The Capacitor project (plan 0167). Flat ESLint does not read .gitignore, so
    // without this it would lint the copy of the built bundle that `cap sync` writes
    // under android/app/src/main/assets/public, and Gradle's copies of it under build/.
    // Anchored with `**/` like the mocks above, because a bare `android/**` matched
    // nothing when Nx ran the lint.
    ignores: ['**/android/**'],
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'app',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'app',
          style: 'kebab-case',
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    // Override or add rules here
    rules: {},
  },
];
