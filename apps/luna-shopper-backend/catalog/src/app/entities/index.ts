import { Item } from './item.entity';
import { PriceScope } from './price-scope.entity';
import { SupermarketItem } from './supermarket-item.entity';
import { SupermarketLocationItem } from './supermarket-location-item.entity';
import { SupermarketLocation } from './supermarket-location.entity';
import { Supermarket } from './supermarket.entity';

export { BaseEntity } from './base.entity';
export { Item } from './item.entity';
export { PriceScope } from './price-scope.entity';
export { SupermarketItem } from './supermarket-item.entity';
export { SupermarketLocationItem } from './supermarket-location-item.entity';
export { SupermarketLocation } from './supermarket-location.entity';
export { Supermarket } from './supermarket.entity';

/** Every catalog entity, for TypeOrmModule registration and the CLI data source. */
export const CATALOG_ENTITIES = [
  Supermarket,
  PriceScope,
  SupermarketLocation,
  Item,
  SupermarketItem,
  SupermarketLocationItem,
];
