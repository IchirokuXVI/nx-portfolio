export * from './lib/admin-environment';
export * from './lib/admin-identity';
export * from './lib/admin-session';
export * from './lib/app-api-config';
export * from './lib/app-key';
export * from './lib/deployment';
export * from './lib/harvest/harvest-run';
export * from './lib/harvest/harvest-switches';
export * from './lib/reachability-policy';
export * from './lib/resource/composite-id';
export * from './lib/resource/localized-text';
export * from './lib/resource/money';
export * from './lib/resource/resource-descriptor';
export * from './lib/resource/resource-draft';
export * from './lib/resource/resource-field';
export * from './lib/resource/resource-pagination';
export * from './lib/resource/resource-view';
export * from './lib/session-keepalive';
export * from './lib/sign-in-failure';

/**
 * The gateway's own shapes, generated from its OpenAPI document.
 *
 * Under a namespace rather than spread into this barrel, for two reasons. There
 * are several hundred of them and they would bury the eight types this library
 * writes by hand; and `Wire.CatalogSupermarketView` says where a type came from
 * at the point it is used, which is the honest label for a type this app did not
 * author and cannot change.
 */
export * as Wire from './lib/wire/wire-types';
