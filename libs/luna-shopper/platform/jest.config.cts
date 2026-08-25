module.exports = {
  displayName: 'luna-shopper/platform',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // Integration specs (real NATS) run under jest.integration.config.cts via the
  // test-integration target, never in the fast infra-free unit suite.
  testPathIgnorePatterns: ['/node_modules/', '\\.integration\\.spec\\.ts$'],
  coverageDirectory: '../../../coverage/libs/luna-shopper/platform',
};
