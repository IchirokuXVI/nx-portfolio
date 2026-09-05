import { CatalogAudit } from './catalog-audit.entity';
import { ItemPriceDetailsRow } from './item-price-details.entity';
import { ItemPrice } from './item-price.entity';
import { Item } from './item.entity';
import { PostalCodePoint } from './postal-code-point.entity';
import { PricePolicy } from './price-policy.entity';
import { PriceScope } from './price-scope.entity';
import { ProductGroup } from './product-group.entity';
import { SupermarketItem } from './supermarket-item.entity';
import { SupermarketLocationItem } from './supermarket-location-item.entity';
import { SupermarketLocation } from './supermarket-location.entity';
import { Supermarket } from './supermarket.entity';

export { BaseEntity } from './base.entity';
export {
  AuditAction,
  AuditActorKind,
  CatalogAudit,
} from './catalog-audit.entity';
export { ItemPriceDetailsRow } from './item-price-details.entity';
export { ItemPrice } from './item-price.entity';
export { Item } from './item.entity';
export { PostalCodePoint } from './postal-code-point.entity';
export { PricePolicy } from './price-policy.entity';
export { PriceScope } from './price-scope.entity';
export { ProductGroup } from './product-group.entity';
export { SupermarketItem } from './supermarket-item.entity';
export { SupermarketLocationItem } from './supermarket-location-item.entity';
export { SupermarketLocation } from './supermarket-location.entity';
export { Supermarket } from './supermarket.entity';

/** Every catalog entity, for TypeOrmModule registration and the CLI data source. */
export const CATALOG_ENTITIES = [
  Supermarket,
  PriceScope,
  SupermarketLocation,
  // Groups come before items: an item may point at one (plan 0048, section 1).
  ProductGroup,
  Item,
  // Every price a source gave, and the policy that picks one (plan 0080). The
  // materialized row below them is derived from both.
  ItemPrice,
  // What a leaflet printed beside a price (plan 0081, section 6.4). Kept off
  // `item_prices` because that table is read on every recompute.
  ItemPriceDetailsRow,
  PricePolicy,
  SupermarketItem,
  SupermarketLocationItem,
  // Reference data, loaded by a migration and never written by a service
  // (plan 0060, section 2).
  PostalCodePoint,
  // Written inside every write above it, and read by nothing (plan 0075).
  CatalogAudit,
];
