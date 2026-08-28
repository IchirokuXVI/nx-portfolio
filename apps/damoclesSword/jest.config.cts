module.exports = {
  displayName: 'damoclesSword',
  preset: '../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../coverage/apps/damoclesSword',
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
    //
    // The app needs this because `translation-providers.ts` imports the ui
    // library's barrel for its translation descriptor, and that barrel reaches
    // components that import SVGs. The library's own config has mapped these all
    // along; the app's had never needed to.
    '\\.(avif|png|jpe?g|gif|webp|svg|ttf|woff2?|mp4|webm|pdf)(\\?.*)?$':
      '<rootDir>/src/asset-file-mock.ts',
  },
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
};
