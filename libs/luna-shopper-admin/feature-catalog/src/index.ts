// Named, and not `export *`: this barrel offers what another project imports,
// and nothing else (admin plan 0047). A name used only inside this library is
// imported there by its relative path. `no-unused-public-export.spec.ts`
// in the app fails when a name here has no importer outside the library.
export { priceScopeMark } from './lib/catalog-enums';
export { priceScopeSource } from './lib/catalog-sources';
export { CHAIN_RESOURCES, chainsRoutes } from './lib/chains/chains-routes';
export { LOCATIONS } from './lib/locations';
export { PRICE_SCOPES, type PriceScope } from './lib/price-scopes';
export { formatSize } from './lib/products/product-format';
export { PRODUCT_SCOPE_QUERY } from './lib/products/product-prices-tab';
export {
  PRODUCTS_SEGMENT,
  PRODUCT_RESOURCES,
  productsRoutes,
} from './lib/products/products-routes';
export { SUPERMARKETS } from './lib/supermarkets';
