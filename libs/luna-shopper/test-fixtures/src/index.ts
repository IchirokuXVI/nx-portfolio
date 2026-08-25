// Luna Shopper test data (plan 0013). The single source of truth for what the
// test data IS, independent of where it lands: unit tests import the factories
// and fixed ids directly; the per service database seeders insert the same
// canonical `demoWorld` through the real repositories.

export * from './lib/demo-world';
export * from './lib/factories';
export * from './lib/ids';
export * from './lib/types';
