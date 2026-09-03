import { CatalogAudit } from './catalog-audit.entity';
import { Item } from './item.entity';
import { PostalCodePoint } from './postal-code-point.entity';
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
export { Item } from './item.entity';
export { PostalCodePoint } from './postal-code-point.entity';
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
  SupermarketItem,
  SupermarketLocationItem,
  // Reference data, loaded by a migration and never written by a service
  // (plan 0060, section 2).
  PostalCodePoint,
  // Written inside every write above it, and read by nothing (plan 0075).
  CatalogAudit,
];
