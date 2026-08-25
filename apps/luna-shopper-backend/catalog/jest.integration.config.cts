// Integration test config (plan 0010, section 1; plan 0015, section 3.3): runs
// only the `*.integration.spec.ts` files, which exercise a real Postgres from the
// dev compose stack. Kept separate from the default unit `test` target so the
// fast, infra-free suite never needs Docker. Run via the `test-integration`
// target with LUNA_INTEGRATION=1 after `docker compose up`.
//
// Catalog got this target late (plan 0015): it owns its own database and its own
// migrations, so it carries the same schema risk auth and core do, and leaving it
// out meant `nx run-many -t test-integration` silently covered two of the three.
module.exports = {
  displayName: 'luna-shopper-backend-catalog-integration',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  testMatch: ['**/*.integration.spec.ts'],
  // Creates the directory the JSON summary is written into; Jest's --outputFile
  // does not mkdir (plan 0015, section 3.3).
  globalSetup: '<rootDir>/../tools/ci/ensure-summary-dir.js',
  coverageDirectory:
    '../../../coverage/apps/luna-shopper-backend/catalog-integration',
};
