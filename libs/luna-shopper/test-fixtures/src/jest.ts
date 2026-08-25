// The Jest only surface of the test-fixtures library (plan 0015, section 3.1).
//
// It is a second entry point rather than part of the package barrel because the
// gate below reaches for Jest's globals, and the barrel is also imported by the
// Playwright e2e suite, which has no `describe`. Import it as
// `@portfolio/luna-shopper/test-fixtures/jest`.

export * from './lib/infra-gate';
