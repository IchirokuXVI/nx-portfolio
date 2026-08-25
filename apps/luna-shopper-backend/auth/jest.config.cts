module.exports = {
  displayName: 'luna-shopper-backend-auth',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // Integration specs (real Postgres) run under jest.integration.config.cts via
  // the test-integration target, never in the fast infra-free unit suite.
  testPathIgnorePatterns: ['/node_modules/', '\\.integration\\.spec\\.ts$'],
  coverageDirectory: '../../../coverage/apps/luna-shopper-backend/auth',
};
