module.exports = {
  displayName: 'luna-shopper-backend-harvester',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  // `json` as well as the scaffolded three: the leaflet specs import the
  // extractor's committed outputs as fixtures (plan 0081, section 9), and
  // overriding this list is what drops jest's own default for them.
  moduleFileExtensions: ['ts', 'js', 'json', 'html'],
  // Integration specs (real Postgres) run under jest.integration.config.cts via
  // the test-integration target, never in the fast infra-free unit suite.
  testPathIgnorePatterns: ['/node_modules/', '\\.integration\\.spec\\.ts$'],
  coverageDirectory: '../../../coverage/apps/luna-shopper-backend/harvester',
};
