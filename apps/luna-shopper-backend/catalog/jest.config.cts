module.exports = {
  displayName: 'luna-shopper-backend-catalog',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // Integration specs (real Postgres) run under jest.integration.config.cts via
  // the test-integration target, never in the fast infra-free unit suite. Without
  // this the unit run picks them up and the gate fails them outright under
  // LUNA_REQUIRE_STACK, which is set for the whole CI job.
  testPathIgnorePatterns: ['/node_modules/', '\\.integration\\.spec\\.ts$'],
  coverageDirectory: '../../../coverage/apps/luna-shopper-backend/catalog',
};
