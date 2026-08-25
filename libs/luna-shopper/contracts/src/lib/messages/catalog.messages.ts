import type { ItemCategory, UnitOfMeasure } from '../enums/catalog.enums';
import type { PageQuery, Paginated } from '../pagination';

/**
 * Catalog message contracts (plan 0012). The gateway calls these on the catalog
 * service over NATS. Writes are gated behind a platform-admin role (the app owner
 * alone); reads are open to any authenticated user. Every localized text field
 * carries at least English and Spanish (plan 0004, section 12). The catalog owns
 * its own database and is referenced from core only by an opaque `itemId`; it is
 * deliberately NOT part of the realtime fan-out, so it defines no events.
 */

/** A reference/catalog text stored multilingual (English + Spanish minimum). */
export interface LocalizedText {
  en: string;
  es: string;
}

export const SUPERMARKET_PATTERNS = {
  create: 'supermarket.create',
  update: 'supermarket.update',
  delete: 'supermarket.delete',
  get: 'supermarket.get',
  list: 'supermarket.list',
} as const;

export const SUPERMARKET_LOCATION_PATTERNS = {
  create: 'supermarketLocation.create',
  update: 'supermarketLocation.update',
  delete: 'supermarketLocation.delete',
  get: 'supermarketLocation.get',
  list: 'supermarketLocation.list',
} as const;

export const ITEM_PATTERNS = {
  create: 'item.create',
  update: 'item.update',
  delete: 'item.delete',
  get: 'item.get',
  search: 'item.search',
} as const;

export const SUPERMARKET_ITEM_PATTERNS = {
  upsert: 'supermarketItem.upsert',
  delete: 'supermarketItem.delete',
  get: 'supermarketItem.get',
  listByItem: 'supermarketItem.listByItem',
  listByLocation: 'supermarketItem.listByLocation',
} as const;

// --- Views -----------------------------------------------------------------

export interface SupermarketView {
  id: string;
  name: LocalizedText;
  logoUrl: string | null;
  websiteUrl: string | null;
}

export interface SupermarketLocationView {
  id: string;
  supermarketId: string;
  label: LocalizedText | null;
  address: string | null;
  city: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface ItemView {
  id: string;
  name: LocalizedText;
  brand: string | null;
  imageUrl: string | null;
  sku: string | null;
  category: ItemCategory;
  defaultUnit: UnitOfMeasure;
}

export interface SupermarketItemView {
  id: string;
  itemId: string;
  supermarketLocationId: string;
  price: number | null;
  currency: string | null;
  positionInStore: string | null;
  available: boolean;
}

// --- Supermarket requests --------------------------------------------------

export interface CreateSupermarketRequest {
  userId: string;
  name: LocalizedText;
  logoUrl?: string | null;
  websiteUrl?: string | null;
}

export interface UpdateSupermarketRequest {
  userId: string;
  supermarketId: string;
  name?: LocalizedText;
  logoUrl?: string | null;
  websiteUrl?: string | null;
}

export interface SupermarketIdRequest {
  userId: string;
  supermarketId: string;
}

export interface ListSupermarketsRequest extends PageQuery {
  userId: string;
}

// --- Supermarket location requests -----------------------------------------

export interface CreateSupermarketLocationRequest {
  userId: string;
  supermarketId: string;
  label?: LocalizedText | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface UpdateSupermarketLocationRequest {
  userId: string;
  supermarketLocationId: string;
  label?: LocalizedText | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface SupermarketLocationIdRequest {
  userId: string;
  supermarketLocationId: string;
}

export interface ListSupermarketLocationsRequest extends PageQuery {
  userId: string;
  supermarketId: string;
}

// --- Item requests ---------------------------------------------------------

export interface CreateItemRequest {
  userId: string;
  name: LocalizedText;
  brand?: string | null;
  imageUrl?: string | null;
  sku?: string | null;
  category: ItemCategory;
  defaultUnit: UnitOfMeasure;
}

export interface UpdateItemRequest {
  userId: string;
  itemId: string;
  name?: LocalizedText;
  brand?: string | null;
  imageUrl?: string | null;
  sku?: string | null;
  category?: ItemCategory;
  defaultUnit?: UnitOfMeasure;
}

export interface ItemIdRequest {
  userId: string;
  itemId: string;
}

export interface SearchItemsRequest extends PageQuery {
  userId: string;
  query?: string;
  category?: ItemCategory;
}

// --- Supermarket item requests ---------------------------------------------

export interface UpsertSupermarketItemRequest {
  userId: string;
  itemId: string;
  supermarketLocationId: string;
  price?: number | null;
  currency?: string | null;
  positionInStore?: string | null;
  available?: boolean;
}

export interface SupermarketItemIdRequest {
  userId: string;
  supermarketItemId: string;
}

export interface GetSupermarketItemRequest {
  userId: string;
  itemId: string;
  supermarketLocationId: string;
}

export interface ListSupermarketItemsByItemRequest extends PageQuery {
  userId: string;
  itemId: string;
}

export interface ListSupermarketItemsByLocationRequest extends PageQuery {
  userId: string;
  supermarketLocationId: string;
}

// --- Pages -----------------------------------------------------------------

export type SupermarketPage = Paginated<SupermarketView>;
export type SupermarketLocationPage = Paginated<SupermarketLocationView>;
export type ItemPage = Paginated<ItemView>;
export type SupermarketItemPage = Paginated<SupermarketItemView>;

/** Orders a caller may choose for the catalog collections (plan 0012). */
export const ITEM_ORDERS = ['name', 'created', 'updated'] as const;
export type ItemOrder = (typeof ITEM_ORDERS)[number];

export const SUPERMARKET_ORDERS = ['name', 'created', 'updated'] as const;
export type SupermarketOrder = (typeof SUPERMARKET_ORDERS)[number];
