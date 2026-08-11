module.exports = {
  displayName: 'landing-v2/feature-project',
  preset: '../../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../../coverage/libs/landing-v2/feature-project',
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
    // Rendered detail-page-shell + icon components import static assets
    // directly; map them to a stub so this project's own test run doesn't
    // try to resolve them as literal files.
    '\\.(avif|png|jpe?g|gif|webp|svg|ttf|woff2?|mp4|webm|pdf)(\\?.*)?$':
      '<rootDir>/src/asset-file-mock.ts',
  },
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
};
