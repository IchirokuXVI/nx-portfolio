module.exports = {
  displayName: 'damoclesSword/data-access',
  preset: '../../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../../coverage/libs/damoclesSword/data-access',
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
  },
  transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$)'],
  moduleNameMapper: {
    // Data assets (news/project media) are imported here; the bundler resolves
    // them to a URL at build time, so in tests we map them to a stub value.
    '\\.(avif|png|jpe?g|gif|webp|svg|ttf|woff2?|mp4|webm)$':
      '<rootDir>/src/asset-file-mock.ts',
  },
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
};
