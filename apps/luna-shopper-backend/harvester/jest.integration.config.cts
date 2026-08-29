// Integration test config (plan 0015, section 3.3): runs only the
// `*.integration.spec.ts` files, which exercise a real Postgres from the dev
// compose stack. Kept separate from the default unit `test` target so the fast,
// infra-free suite never needs Docker.
//
// The harvester owns its own database and its own migrations, so it carries the
// same schema risk auth, core and catalog do, and it gets the same net.
module.exports = {
  displayName: 'luna-shopper-backend-harvester-integration',
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
    '../../../coverage/apps/luna-shopper-backend/harvester-integration',
};
