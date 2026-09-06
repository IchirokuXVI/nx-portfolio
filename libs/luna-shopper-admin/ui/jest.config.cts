module.exports = {
  displayName: 'luna-shopper-admin/ui',
  preset: '../../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../../coverage/libs/luna-shopper-admin/ui',
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
  },
  // d3's arithmetic modules ship ES modules and nothing else: their `main` is
  // `src/index.js`, so jest loads the source and stops at the first `export`.
  // They are named here rather than mapped to a UMD build, because the mapping
  // would reach the app bundle too, and tree shaking is the reason these three
  // were taken instead of `d3` itself.
  transformIgnorePatterns: ['node_modules/(?!(?:.*\\.mjs$|d3-|internmap))'],
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
};
