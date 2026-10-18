module.exports = {
  displayName: 'velista/feature-shell',
  preset: '../../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../../coverage/libs/velista/feature-shell',
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
  },
  moduleNameMapper: {
    // The 404 page renders a `ui` icon, and those inline their glyph with a `?raw`
    // import. Without this mapping the bundler-only query suffix reaches Jest as a
    // literal file path and fails to resolve.
    '\\.(avif|png|jpe?g|gif|webp|svg|ttf|woff2?|mp4|webm|pdf)(\\?.*)?$':
      '<rootDir>/src/asset-file-mock.ts',
  },
  transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$)'],
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
};
