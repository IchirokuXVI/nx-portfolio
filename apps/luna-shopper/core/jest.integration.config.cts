// Integration test config (plan 0010, section 1): runs only the
// `*.integration.spec.ts` files, which exercise real Postgres/NATS from the dev
// compose stack. Kept separate from the default unit `test` target so the fast,
// infra-free suite never needs Docker. Run via the `test-integration` target with
// LUNA_INTEGRATION=1 after `docker compose up`.
module.exports = {
  displayName: 'luna-shopper-core-integration',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  testMatch: ['**/*.integration.spec.ts'],
  coverageDirectory: '../../../coverage/apps/luna-shopper/core-integration',
};
