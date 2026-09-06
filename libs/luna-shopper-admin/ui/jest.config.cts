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
  // d3's arithmetic modules ship ES modules and nothing else, so their `main` is
  // the source and jest stops at the first `export`. Every project that reaches
  // `@portfolio/luna-shopper-admin/ui` reaches them through it, so this line is
  // the same in every config here (admin plan 0015, section 1). Mapping them to
  // their UMD builds instead would reach the app bundle too, and tree shaking is
  // the reason those three were taken rather than `d3` itself.
  transformIgnorePatterns: ['node_modules/(?!(?:.*\\.mjs$|d3-|internmap))'],
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
};
