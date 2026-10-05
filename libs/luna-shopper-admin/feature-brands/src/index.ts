// Named, and not `export *`: this barrel offers what another project imports,
// and nothing else (admin plan 0047). A name used only inside this library is
// imported there by its relative path. `no-unused-public-export.spec.ts`
// in the app fails when a name here has no importer outside the library.
export { BrandDetailPage } from './lib/brand-detail-page';
export { BrandSuggestionsPage } from './lib/brand-suggestions-page';
export { BRANDS } from './lib/brands';
