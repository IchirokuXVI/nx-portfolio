module.exports = {
  displayName: 'velista/feature-install',
  preset: '../../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../../coverage/libs/velista/feature-install',
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
    // This library renders `ui` components, and those inline their icons with a
    // `?raw` import. Without the same mapping the bundler-only query suffix reaches
    // Jest as a literal file path and fails to resolve.
    '\\.(avif|png|jpe?g|gif|webp|svg|ttf|woff2?|mp4|webm|pdf)(\\?.*)?$':
      '<rootDir>/src/asset-file-mock.ts',
  },
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
};
