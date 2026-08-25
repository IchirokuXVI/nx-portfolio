import type {
  ItemView,
  SupermarketItemView,
  SupermarketLocationView,
  SupermarketView,
} from '@portfolio/luna-shopper/contracts';
import type {
  Item,
  SupermarketItem,
  SupermarketLocation,
  Supermarket,
} from '../entities';

export function toSupermarketView(row: Supermarket): SupermarketView {
  return {
    id: row.id,
    name: row.name,
    logoUrl: row.logoUrl,
    websiteUrl: row.websiteUrl,
  };
}

export function toSupermarketLocationView(
  row: SupermarketLocation
): SupermarketLocationView {
  return {
    id: row.id,
    supermarketId: row.supermarketId,
    label: row.label,
    address: row.address,
    city: row.city,
    country: row.country,
    latitude: row.latitude,
    longitude: row.longitude,
  };
}

export function toItemView(row: Item): ItemView {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    imageUrl: row.imageUrl,
    sku: row.sku,
    category: row.category,
    defaultUnit: row.defaultUnit,
  };
}

export function toSupermarketItemView(
  row: SupermarketItem
): SupermarketItemView {
  return {
    id: row.id,
    itemId: row.itemId,
    supermarketLocationId: row.supermarketLocationId,
    // Postgres `numeric` comes back as a string through node-postgres; normalise
    // it to a number for the wire contract (null stays null).
    price: row.price === null ? null : Number(row.price),
    currency: row.currency,
    positionInStore: row.positionInStore,
    available: row.available,
  };
}
