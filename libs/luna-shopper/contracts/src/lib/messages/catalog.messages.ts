import type {
  ItemCategory,
  PriceScopeKind,
  PriceSourceKind,
  UnitOfMeasure,
} from '../enums/catalog.enums';
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
  /** EAN is unique when present, so this is a lookup, not a search (plan 0038). */
  findByEan: 'item.findByEan',
} as const;

export const SUPERMARKET_ITEM_PATTERNS = {
  upsert: 'supermarketItem.upsert',
  /**
   * Write many prices in one call (plan 0038, section 7). A harvest run writes
   * hundreds of prices per scope and would otherwise make one NATS round trip per
   * item; the payload cap is what bounds a batch, not a policy.
   */
  upsertBatch: 'supermarketItem.upsertBatch',
  delete: 'supermarketItem.delete',
  get: 'supermarketItem.get',
  listByItem: 'supermarketItem.listByItem',
  listByLocation: 'supermarketItem.listByLocation',
  listByScope: 'supermarketItem.listByScope',
} as const;

/**
 * Price scopes (plan 0038, section 5.1). Prices are keyed on a scope rather than
 * on a store, so a chain that publishes one price per warehouse stores one row
 * per warehouse instead of one per store. Platform admin gated, like every other
 * catalog write.
 */
export const PRICE_SCOPE_PATTERNS = {
  create: 'priceScope.create',
  update: 'priceScope.update',
  delete: 'priceScope.delete',
  list: 'priceScope.list',
} as const;

/**
 * The genuinely per store half of a `SupermarketItem` (plan 0038, section 5.2):
 * where the product sits in *this* shop, and an optional per store availability
 * override. Split out when the price moved to the scope, because a position in an
 * aisle is not something a warehouse can answer.
 */
export const SUPERMARKET_LOCATION_ITEM_PATTERNS = {
  upsert: 'supermarketLocationItem.upsert',
  get: 'supermarketLocationItem.get',
  listByLocation: 'supermarketLocationItem.listByLocation',
} as const;

// --- Views -----------------------------------------------------------------

export interface SupermarketView {
  id: string;
  name: LocalizedText;
  logoUrl: string | null;
  websiteUrl: string | null;
  /**
   * The chain's stable identity across discovery runs and providers, here the
   * Wikidata QID (plan 0038, section 5.4). Nullable because an independent shop
   * has none, and owner editable because the QID splits `Carrefour` from
   * `Carrefour Express`, which may or may not be what the owner wants.
   */
  externalBrandKey: string | null;
}

export interface SupermarketLocationView {
  id: string;
  supermarketId: string;
  /** The scope whose prices this store sells at (plan 0038, section 5.1). */
  priceScopeId: string;
  label: LocalizedText | null;
  address: string | null;
  city: string | null;
  country: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  /**
   * The discovery provider's own reference, e.g. `node/1156230891`. Not a
   * reliable primary identity: an OSM element changes id and type when someone
   * upgrades a shop from a node to a mapped building way, so re-discovery matches
   * on it first and then falls back to "same brand within 50 metres".
   */
  externalRef: string | null;
  externalProvider: string | null;
}

/**
 * One price scope: the set of stores a chain charges the same in (plan 0038,
 * section 5.1). Mercadona gets one WAREHOUSE scope per warehouse code; a chain
 * with no obtainable data gets one STORE scope per location and hand entered
 * prices, and needs no special case anywhere.
 */
export interface PriceScopeView {
  id: string;
  supermarketId: string;
  kind: PriceScopeKind;
  /**
   * The source's own key for the scope, e.g. Mercadona's warehouse. A string and
   * never an integer: the warehouse key comes back in two shapes, a numeric code
   * (`4661`) and a city slug (`mad3`).
   */
  externalKey: string | null;
  label: LocalizedText | null;
}

export interface ItemView {
  id: string;
  name: LocalizedText;
  brand: string | null;
  imageUrl: string | null;
  sku: string | null;
  /**
   * The only identifier that joins a product across chains, and the reason
   * catalog discovery pays one detail request per product (plan 0038, section
   * 2.5). Unique when present.
   */
  ean: string | null;
  /** Without it `defaultUnit` says nothing: "LITER" is not a size. */
  unitSize: number | null;
  category: ItemCategory;
  defaultUnit: UnitOfMeasure;
}

/**
 * The price of one item within one price scope (plan 0038, section 5.2). It was
 * keyed on the store until the scope arrived, which is what stopped Mercadona
 * writing twelve identical rows for Córdoba. What is genuinely per store (where
 * the product sits in the aisle) moved to {@link SupermarketLocationItemView}.
 */
export interface SupermarketItemView {
  id: string;
  itemId: string;
  priceScopeId: string;
  price: number | null;
  currency: string | null;
  /**
   * The source's own normalized price per reference unit, stored verbatim and
   * **never recomputed** (plan 0038, section 2.4). The obvious derivation
   * disagrees with the chain on one product in forty, in the field whose only
   * purpose is comparison.
   */
  unitPrice: number | null;
  /**
   * The label the source shows next to `unitPrice`. Deliberately text and not a
   * `UnitOfMeasure`: a product labelled `100 ml` carries a per litre number and
   * `lv` means washing machine loads, so it is a price tag for a human and cannot
   * be parsed into a unit.
   */
  unitPriceLabel: string | null;
  /** Without it a price has no age. */
  priceObservedAt: string | null;
  priceSourceKind: PriceSourceKind;
  /**
   * Whether the scope carries this product at all. Scope wide rather than per
   * store because an automated source can only answer it at that level: a 404
   * from a detail call means "not stocked in this warehouse".
   */
  available: boolean;
}

/**
 * The per store half (plan 0038, section 5.2). `available` here is a **nullable
 * override** meaning "someone checked this specific shop"; null means "no store
 * specific information, use the scope's". Two columns, two different claims,
 * neither pretending to be the other.
 */
export interface SupermarketLocationItemView {
  id: string;
  itemId: string;
  supermarketLocationId: string;
  positionInStore: string | null;
  available: boolean | null;
}

// --- Supermarket requests --------------------------------------------------

export interface CreateSupermarketRequest {
  userId: string;
  name: LocalizedText;
  logoUrl?: string | null;
  websiteUrl?: string | null;
  externalBrandKey?: string | null;
}

export interface UpdateSupermarketRequest {
  userId: string;
  supermarketId: string;
  name?: LocalizedText;
  logoUrl?: string | null;
  websiteUrl?: string | null;
  externalBrandKey?: string | null;
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
  /**
   * Optional: a location with no scope named is given its chain's STORE scope for
   * this location, created on the spot, so hand entered supermarkets keep working
   * exactly as they did before scopes existed.
   */
  priceScopeId?: string;
  label?: LocalizedText | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  postalCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  externalRef?: string | null;
  externalProvider?: string | null;
}

export interface UpdateSupermarketLocationRequest {
  userId: string;
  supermarketLocationId: string;
  priceScopeId?: string;
  label?: LocalizedText | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  postalCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  externalRef?: string | null;
  externalProvider?: string | null;
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
  ean?: string | null;
  unitSize?: number | null;
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
  ean?: string | null;
  unitSize?: number | null;
  category?: ItemCategory;
  defaultUnit?: UnitOfMeasure;
}

/** Find the item carrying this EAN, if catalog has one (plan 0038, section 6.2). */
export interface FindItemByEanRequest {
  userId: string;
  ean: string;
}

/**
 * A lookup that is allowed to find nothing. Wrapped rather than returning
 * `ItemView | null` directly so the reply has one JSON Schema, like every other
 * subject here.
 */
export interface FindItemByEanResult {
  item: ItemView | null;
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

/**
 * Write one price for one item in one scope. Called by hand through the gateway
 * it sets `priceSourceKind` to ADMIN and **pins** the row: section 6.5's rule is
 * that an automated fetch will not overwrite it afterwards.
 */
export interface UpsertSupermarketItemRequest {
  userId: string;
  itemId: string;
  priceScopeId: string;
  price?: number | null;
  currency?: string | null;
  unitPrice?: number | null;
  unitPriceLabel?: string | null;
  available?: boolean;
  /**
   * Where this number came from. Defaults to ADMIN, which is what a person
   * editing through the gateway means. A harvest run sends OFFICIAL_API, and the
   * service then applies section 6.5 rather than writing unconditionally.
   */
  priceSourceKind?: PriceSourceKind;
  /** When the source observed it. Defaults to now for an ADMIN write. */
  priceObservedAt?: string | null;
}

/** One entry of a batch write. The scope and the actor are stated once, above. */
export interface SupermarketItemBatchEntry {
  itemId: string;
  price?: number | null;
  currency?: string | null;
  unitPrice?: number | null;
  unitPriceLabel?: string | null;
  available?: boolean;
  priceObservedAt?: string | null;
}

/**
 * Write many prices for one scope in one call (plan 0038, section 7), so a run
 * does not make one round trip per item. Section 6.5 is applied per entry, and
 * the entries it declined are reported rather than silently dropped.
 */
export interface UpsertSupermarketItemBatchRequest {
  userId: string;
  priceScopeId: string;
  priceSourceKind: PriceSourceKind;
  entries: SupermarketItemBatchEntry[];
}

/**
 * What a batch did. `skipped` carries the rows section 6.5 refused to overwrite,
 * with the value that was fetched, because a disagreement the owner cannot see is
 * the same as no rule at all.
 */
export interface UpsertSupermarketItemBatchResult {
  created: number;
  updated: number;
  unchanged: number;
  skipped: SupermarketItemPriceDisagreement[];
}

export interface SupermarketItemPriceDisagreement {
  itemId: string;
  /** The price already stored, which was not touched. */
  storedPrice: number | null;
  storedSourceKind: PriceSourceKind;
  /** What the source said instead. */
  fetchedPrice: number | null;
}

export interface SupermarketItemIdRequest {
  userId: string;
  supermarketItemId: string;
}

export interface GetSupermarketItemRequest {
  userId: string;
  itemId: string;
  priceScopeId: string;
}

export interface ListSupermarketItemsByItemRequest extends PageQuery {
  userId: string;
  itemId: string;
}

/**
 * Still keyed on a location, because that is the question a shopper asks ("what
 * does this shop charge"). The service resolves the location to its scope and
 * pages the scope's rows, so the subject survived the re-keying unchanged.
 */
export interface ListSupermarketItemsByLocationRequest extends PageQuery {
  userId: string;
  supermarketLocationId: string;
}

export interface ListSupermarketItemsByScopeRequest extends PageQuery {
  userId: string;
  priceScopeId: string;
}

// --- Price scope requests --------------------------------------------------

export interface CreatePriceScopeRequest {
  userId: string;
  supermarketId: string;
  kind: PriceScopeKind;
  externalKey?: string | null;
  label?: LocalizedText | null;
}

export interface UpdatePriceScopeRequest {
  userId: string;
  priceScopeId: string;
  kind?: PriceScopeKind;
  externalKey?: string | null;
  label?: LocalizedText | null;
}

export interface PriceScopeIdRequest {
  userId: string;
  priceScopeId: string;
}

export interface ListPriceScopesRequest extends PageQuery {
  userId: string;
  supermarketId?: string;
}

// --- Supermarket location item requests ------------------------------------

export interface UpsertSupermarketLocationItemRequest {
  userId: string;
  itemId: string;
  supermarketLocationId: string;
  positionInStore?: string | null;
  /** Null clears the override and defers to the scope's `available`. */
  available?: boolean | null;
}

export interface GetSupermarketLocationItemRequest {
  userId: string;
  itemId: string;
  supermarketLocationId: string;
}

export interface ListSupermarketLocationItemsRequest extends PageQuery {
  userId: string;
  supermarketLocationId: string;
}

// --- Pages -----------------------------------------------------------------

export type SupermarketPage = Paginated<SupermarketView>;
export type SupermarketLocationPage = Paginated<SupermarketLocationView>;
export type ItemPage = Paginated<ItemView>;
export type SupermarketItemPage = Paginated<SupermarketItemView>;
export type PriceScopePage = Paginated<PriceScopeView>;
export type SupermarketLocationItemPage =
  Paginated<SupermarketLocationItemView>;

/** Orders a caller may choose for the catalog collections (plan 0012). */
export const ITEM_ORDERS = ['name', 'created', 'updated'] as const;
export type ItemOrder = (typeof ITEM_ORDERS)[number];

export const SUPERMARKET_ORDERS = ['name', 'created', 'updated'] as const;
export type SupermarketOrder = (typeof SUPERMARKET_ORDERS)[number];
