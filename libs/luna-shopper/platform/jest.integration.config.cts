// Integration test config for the platform library (plan 0016, section 10).
//
// The unit `test` target stays infra free; this one runs only the
// `*.integration.spec.ts` files, which need the dev compose stack's NATS. It
// exists because the propagation guard is only meaningful over a real broker: a
// mock cannot show that the W3C headers survive the wire.
//
// Run via the `test-integration` target with LUNA_INTEGRATION=1 after
// `docker compose up --wait`.
module.exports = {
  displayName: 'luna-shopper-platform-integration',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  testMatch: ['**/*.integration.spec.ts'],
  // Creates the directory the JSON summary is written into; Jest's --outputFile
  // does not mkdir (plan 0015, section 3.3).
  globalSetup:
    '<rootDir>/../../../apps/luna-shopper-backend/tools/ci/ensure-summary-dir.js',
  coverageDirectory: '../../../coverage/libs/luna-shopper/platform-integration',
};
