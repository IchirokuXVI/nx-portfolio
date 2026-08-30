module.exports = {
  displayName: 'luna-shopper-backend-assistant',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // There is deliberately no integration config beside this one, unlike every
  // other service here. This one owns no database, and rule A4 forbids any test
  // in this repository from reaching a model provider, so the whole suite is
  // infrastructure free by construction rather than by being split in two.
  testPathIgnorePatterns: ['/node_modules/'],
  coverageDirectory: '../../../coverage/apps/luna-shopper-backend/assistant',
};
