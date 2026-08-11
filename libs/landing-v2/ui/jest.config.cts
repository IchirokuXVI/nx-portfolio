module.exports = {
  displayName: 'landing-v2/ui',
  preset: '../../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../../coverage/libs/landing-v2/ui',
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
    // Static asset imports resolve to a URL string via the bundler at build
    // time; in tests we map them to a stub so components can import them.
    // The optional `(\?.*)?` tail also matches bundler-only query suffixes
    // like `resume.pdf?asset`, which Jest would otherwise try (and fail) to
    // resolve as a literal file path.
    '\\.(avif|png|jpe?g|gif|webp|svg|ttf|woff2?|mp4|webm|pdf)(\\?.*)?$':
      '<rootDir>/src/asset-file-mock.ts',
  },
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
};
