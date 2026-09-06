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
  // d3-scale and d3-shape are ESM only: their main entry is src/index.js
  // with an export statement in it, so jest has to transform them rather
  // than skip them the way it skips the rest of node_modules. Every d3
  // package and internmap, which d3-scale depends on, are named here. The
  // separator class covers Windows, where a path is spelled with backslashes.
  transformIgnorePatterns: [
    'node_modules[\\\\/](?!(?:.*\\.mjs$|d3-|internmap))',
  ],
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
};
