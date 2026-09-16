module.exports = {
  displayName: 'luna-shopper-admin/feature-brands',
  preset: '../../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../../coverage/libs/luna-shopper-admin/feature-brands',
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
  },
  // d3's arithmetic modules ship ES modules and nothing else, so their `main` is
  // the source and jest stops at the first `export`. Every project that reaches
  // `@portfolio/luna-shopper-admin/ui` reaches them through it, so this line is
  // the same in every config here (admin plan 0015, section 1).
  transformIgnorePatterns: ['node_modules/(?!(?:.*\\.mjs$|d3-|internmap))'],
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
};
