import type {
  ItemCategory,
  PostalCodeSource,
  PriceScopeKind,
  PriceSourceKind,
  UnitOfMeasure,
} from '../enums/catalog.enums';
import type { PageQuery, Paginated } from '../pagination';
import type { AdminCredential } from './admin-auth.messages';

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

/**
 * Alternative words for one thing, per locale (plan 0048, section 1).
 *
 * The reason a group is findable at all: `leche` and `milk` have to reach the one
 * Milk group, and neither is a translation of the group's own name in the other
 * language. Arrays rather than one string because the search builds a text search
 * document from them and a caller editing them edits a list.
 */
export interface LocalizedSynonyms {
  en: string[];
  es: string[];
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
  /**
   * How many shops catalog holds in each of these postal codes (plan 0063,
   * section 5).
   *
   * Not {@link SUPERMARKET_LOCATION_PATTERNS.list}, which is keyed by chain and
   * answers a page: this question is about a place rather than a chain, the
   * caller wants a count and not the rows, and it asks about several codes at
   * once because one profile write announces several. Zero is the answer that
   * earns a discovery run.
   */
  countByPostalCode: 'supermarketLocation.countByPostalCode',
  /**
   * One row per chain with at least one shop in these postal codes (plan 0068,
   * section 3.1). The franchise buttons of `apps/velista/plans/0059`.
   *
   * A grouped count rather than a page, which is the decision
   * {@link SUPERMARKET_LOCATION_PATTERNS.countByPostalCode} made and for the
   * same reason: a country has tens of chains and a neighbourhood a handful,
   * and a cursor over tens of rows is one nobody would ever pass back. The
   * caller wants the whole shape at once because it draws all of it at once.
   */
  summarizeByChain: 'supermarketLocation.summarizeByChain',
  /**
   * A page of shops in these postal codes, optionally one chain's, optionally
   * matching a typed word (plan 0068, section 3.2).
   *
   * Not {@link SUPERMARKET_LOCATION_PATTERNS.list}, which is keyed by chain and
   * answers that chain's shops nationwide: this one is keyed by **place**, which
   * is the axis a shopper actually has. It is one subject rather than a listing
   * and a search beside it, restating plan 0048's decision for `item.search`: no
   * query is a listing, a query narrows the same read.
   */
  search: 'supermarketLocation.search',
} as const;

export const ITEM_PATTERNS = {
  create: 'item.create',
  update: 'item.update',
  delete: 'item.delete',
  get: 'item.get',
  /**
   * Several products by id, in one round trip (plan 0051, section 6.1).
   *
   * A basket line names a pick and every option it may be switched to, all as
   * opaque ids, and a screen of twenty lines with three options each would
   * otherwise be sixty {@link ITEM_PATTERNS.get} calls to render one page. It is
   * a lookup and not a search: unknown ids are simply absent from the answer,
   * because a basket can outlive a product catalog has since deleted and that is
   * an ordinary thing for a history to contain rather than an error.
   */
  getMany: 'item.getMany',
  /**
   * Ranked **items** (plan 0048, section 3). Answers "Pascual Milk".
   *
   * Upgraded in place: the subject, its request and its response are the ones
   * plan 0012 shipped, extended rather than replaced, so the admin surface that
   * calls it with no query keeps getting a listing. What changed underneath is
   * the matching, from a substring scan of one locale's name to the per locale
   * `tsvector` plus trigram index of section 2.
   */
  search: 'item.search',
  /**
   * Ranked **groups**, each with its cheapest member (plan 0048, section 3).
   * Answers "milk", and it is the query the list composer runs for a bare word.
   *
   * A separate subject from {@link ITEM_PATTERNS.search} because the two example
   * queries are genuinely different reads: one ranks products, this one ranks the
   * thing a shopper means and then prices it. A group with no priced member at
   * the requested scopes still comes back, with the price fields null.
   */
  searchOffers: 'item.searchOffers',
  /** EAN is unique when present, so this is a lookup, not a search (plan 0038). */
  findByEan: 'item.findByEan',
} as const;

/**
 * Product groups (plan 0048, section 1): "milk as a thing you can buy", which is
 * a different concept from a browsing category and needs its own entity.
 *
 * Writes are owner curation through the platform admin gate, exactly like every
 * other catalog write. There is deliberately **no automatic assignment**: the
 * matching ladder that would let a harvest run classify what it finds is backlog
 * 0001 section 6.2 and needs the review queue that comes with it.
 */
export const PRODUCT_GROUP_PATTERNS = {
  create: 'productGroup.create',
  update: 'productGroup.update',
  delete: 'productGroup.delete',
  get: 'productGroup.get',
  list: 'productGroup.list',
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
  /**
   * Every price, filtered the way an operator filters them (plan 0073, section
   * 4).
   *
   * A fourth list rather than optional arguments on the three above, because
   * those all start from something the caller already named: a product, a shop,
   * a scope. This one starts from nothing, which is the question "what have I
   * pinned by hand" and is the whole reason the price screen exists. It is
   * reachable only through `/v2/admin/catalog/supermarket-items`.
   */
  adminList: 'supermarketItem.adminList',
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
  /**
   * Turn "these postal codes, these chains" into the scopes that answer it today
   * (plan 0049, sections 1.1 and 3.1).
   *
   * **The resolver lives here and not in core**, beside the scopes it resolves
   * to. A stored scope id silently becomes a lie the moment a chain remaps a
   * postal code to another warehouse, so the postal code is what is stored and
   * this is asked per query, cached briefly.
   *
   * Open to any authenticated caller, like every other catalog read: it says
   * which scopes serve a place, which is public reference data. It takes no
   * `userId` beyond the one every catalog subject carries, and knows nothing
   * about profiles.
   */
  resolve: 'priceScope.resolve',
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
  /**
   * The scope to quote this chain's prices from when nothing else says which
   * (plan 0049, section 3.1, the last rung of the ladder).
   *
   * Owner set and nullable. A result reached through it is returned **flagged as
   * approximate**, so a client can say "prices shown for Madrid" rather than
   * implying the number is the caller's. Silently averaging across a chain's
   * scopes is not the alternative: an average price is a price that exists in no
   * store.
   */
  defaultPriceScopeId: string | null;
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
  /**
   * Where {@link postalCode} came from (plan 0061, section 5), and null wherever
   * the code itself is null.
   *
   * `DERIVED` is the review flag: two thirds of OSM stores carry no postcode, so
   * catalog fills those from the nearest postal code centroid within a bound.
   * That value is an approximation of a boundary by a single point, and this is
   * what lets a reader tell it apart from a code somebody observed.
   */
  postalCodeSource: PostalCodeSource | null;
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
 * One chain with at least one shop in the postal codes asked about (plan 0068,
 * section 3.1).
 *
 * The counts are over **every** shop of that chain in those codes, refused or
 * not, which is what makes the three franchise states of
 * `apps/velista/plans/0059` derivable from one row: `excluded` at zero is "none
 * refused", `excluded` between one and `locations` is "some refused", and the
 * chain's own refusal is the third state, which catalog does not know and the
 * gateway adds (see `ShopChainSummaryView`).
 *
 * **`externalBrandKey` is what survives an import, not a grouping.**
 * `SupermarketLocation.supermarketId` is not nullable, so the harvester gives an
 * unbranded shop a chain named after itself; "Frutería Paco" is a chain with one
 * shop rather than an absent chain. A client buckets the keyless rows into its
 * own OTHER button (plan 0068, section 4), and catalog neither knows nor uses
 * that word.
 */
export interface SupermarketLocationChainSummaryView {
  supermarketId: string;
  name: LocalizedText;
  logoUrl: string | null;
  /** Null for an independent shop, and for a chain nobody has keyed yet. */
  externalBrandKey: string | null;
  /** Shops this chain has in the codes asked about. Never zero: a chain with none is absent. */
  locations: number;
  /** How many of those {@link locations} the caller has refused. */
  excluded: number;
}

/**
 * Every chain with a shop in the codes, unpaged (plan 0068, section 3.1).
 *
 * Wrapped in a named object rather than answered as a bare array, like every
 * other subject here, so the reply has one JSON Schema and can gain a field
 * without breaking a reader.
 */
export interface SupermarketLocationChainSummariesView {
  chains: SupermarketLocationChainSummaryView[];
}

/**
 * A shop as somebody browsing for one sees it (plan 0068, section 3.2).
 *
 * It carries the **chain**, not only its id, because "Ronda de los Tejares" does
 * not identify a shop on its own and a row a client can draw from one response
 * is the whole point of the read.
 *
 * The attribution a client owes for this data travels with the data already:
 * `location.externalProvider` says who discovered the shop and
 * `location.postalCodeSource` says whether its code was observed or derived from
 * a centroid. There is deliberately no attribution string on the view, because
 * that would be the same sentence shipped a thousand times (plan 0068, section
 * 3.3).
 */
export interface ShopView {
  location: SupermarketLocationView;
  supermarket: SupermarketView;
  /**
   * The caller refused **this shop**. Only ever true on a read that asked for
   * the refused ones: they are absent by default (plan 0068, section 6).
   *
   * Flagged rather than merely present, so the row can be drawn switched off
   * without the client cross referencing its profile against the page it just
   * fetched.
   */
  excluded: boolean;
  /** The caller refused the **whole chain**, which hides its future shops too. */
  excludedChain: boolean;
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

/**
 * One thing you can buy, as opposed to one product (plan 0048, section 1).
 *
 * Every Pascual, Central Lechera and Hacendado milk points at the one Milk group,
 * which declares that they are comparable and that the comparison happens in
 * litres. A category is a browsing structure and this is not one: it carries no
 * `categoryId`, because the tree is backlog 0001 section 3.1 and nothing in
 * search or in the composer needs it.
 */
export interface ProductGroupView {
  id: string;
  name: LocalizedText;
  /** Stable and unique, for admin tooling and tests. */
  slug: string;
  /** The unit its members are compared in. */
  referenceUnit: UnitOfMeasure;
  synonyms: LocalizedSynonyms;
}

/**
 * A price quoted by a search result, from the {@link SupermarketItemView} rows
 * plan 0038 already writes (plan 0048, section 3).
 *
 * It carries the source kind and the observation time, so a hand entered price is
 * presentable as one rather than passed off as a chain's published number.
 */
export interface ItemOfferView {
  /** Which product this price is for. Named, because a group's offer is a member's. */
  itemId: string;
  priceScopeId: string;
  price: number | null;
  currency: string | null;
  /** Verbatim, and never recomputed (plan 0038, section 2.4). */
  unitPrice: number | null;
  unitPriceLabel: string | null;
  priceObservedAt: string | null;
  priceSourceKind: PriceSourceKind;
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
  /**
   * The group this product belongs to, or null (plan 0048, section 1). Owner
   * curated: nothing assigns it automatically.
   */
  productGroupId: string | null;
  /**
   * The cheapest price this product has at the scopes the caller asked about, on
   * the reads that take scopes.
   *
   * **Optional, and absent everywhere else.** `item.get`, `item.create` and the
   * rest have no scopes to price against and omit it entirely, which is what lets
   * this be added to the one view every catalog read already answers with rather
   * than forking a second one. Absent and null mean the same thing to a reader:
   * no price to show.
   */
  bestOffer?: ItemOfferView | null;
}

/**
 * A group and the cheapest way to buy it (plan 0048, section 3).
 *
 * `cheapestItem` and `offer` are **both null** when no member is priced at the
 * requested scopes, and the group still comes back: the composer is attaching
 * identity, not quoting a price, and a group must not vanish from suggestions
 * because the one harvested chain is switched off outside development.
 */
export interface ProductGroupOfferView {
  group: ProductGroupView;
  cheapestItem: ItemView | null;
  offer: ItemOfferView | null;
  /**
   * The group's members, which choosing it in the composer copies onto the line
   * whole (plan 0048, section 1.1).
   *
   * It is here, on the suggestion itself, because that copy is **one tap**: the
   * row says how many products it adds before it is chosen, and choosing it adds
   * the line. A client that had to fetch the members first could say neither.
   *
   * Capped at `LINE_ITEM_SET_MAX`, so what a suggestion offers is always
   * something a line can hold. A group past that cap is a curation problem, and
   * a suggestion that 400s on choosing is not the place to report it.
   */
  itemIds: string[];
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

export interface CreateSupermarketRequest extends AdminCredential {
  name: LocalizedText;
  logoUrl?: string | null;
  websiteUrl?: string | null;
  externalBrandKey?: string | null;
}

export interface UpdateSupermarketRequest extends AdminCredential {
  supermarketId: string;
  name?: LocalizedText;
  logoUrl?: string | null;
  websiteUrl?: string | null;
  externalBrandKey?: string | null;
  /**
   * The last rung of the scope ladder (plan 0049, section 3.1). Settable here
   * and not on create: a scope belongs to a chain, so a chain that does not
   * exist yet has none to point at. Must belong to this chain; null clears it.
   */
  defaultPriceScopeId?: string | null;
}

export interface SupermarketIdRequest extends AdminCredential {
  supermarketId: string;
}

export interface ListSupermarketsRequest extends PageQuery {
  userId: string;
  /**
   * Free text over the chain's own name, in either content language, and over
   * its brand key. Absent lists them all.
   *
   * A plain substring match rather than the ranked read a product group gets. A
   * chain has no search document and no synonyms, its name is one or two words,
   * and the operator typing here completes a name they already know.
   */
  query?: string;
}

// --- Supermarket location requests -----------------------------------------

export interface CreateSupermarketLocationRequest extends AdminCredential {
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
  /**
   * ISO 3166-1 alpha-2. Optional, but a location that carries coordinates and no
   * postal code needs it: the centroid lookup that fills the gap is keyed on
   * `(country, postalCode)`, and a search with no country would put Spain and
   * Bolivia in one result (plan 0061, section 4).
   */
  country?: string | null;
  /**
   * Absent, with coordinates and a country present, means "work it out": catalog
   * takes the nearest centroid within the bound and records
   * {@link PostalCodeSource.DERIVED}. A value given here is never overridden.
   */
  postalCode?: string | null;
  /**
   * Where the caller got {@link postalCode}. Defaults to
   * {@link PostalCodeSource.MANUAL}, because a caller with a code and no
   * provenance to declare is a person typing one; the import path states
   * {@link PostalCodeSource.SOURCE}. Ignored when no postal code is given, since
   * a derived code is `DERIVED` by definition.
   */
  postalCodeSource?: PostalCodeSource;
  latitude?: number | null;
  longitude?: number | null;
  externalRef?: string | null;
  externalProvider?: string | null;
}

export interface UpdateSupermarketLocationRequest extends AdminCredential {
  supermarketLocationId: string;
  priceScopeId?: string;
  label?: LocalizedText | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  /**
   * Setting one is a statement and it stands; setting it to null hands the field
   * back to the centroid lookup, which runs again on the row as the update leaves
   * it (plan 0061, section 3).
   */
  postalCode?: string | null;
  postalCodeSource?: PostalCodeSource;
  latitude?: number | null;
  longitude?: number | null;
  externalRef?: string | null;
  externalProvider?: string | null;
}

export interface SupermarketLocationIdRequest extends AdminCredential {
  supermarketLocationId: string;
}

export interface ListSupermarketLocationsRequest extends PageQuery {
  userId: string;
  supermarketId: string;
  /**
   * Only the shops that sell at this scope (plan 0066, section 4). A price is
   * keyed by scope and a scope is not a place, so this is how a price is turned
   * into somewhere to go. Absent lists the whole chain, as before.
   */
  priceScopeId?: string;
  /**
   * Only the shops whose postal code came from here (plan 0073, section 4).
   *
   * {@link PostalCodeSource.DERIVED} is the one an operator asks for: it means
   * the code was inferred from the nearest centroid rather than known, and
   * `apps/luna-shopper-admin/plans/0005` section 3 is the screen that lists them.
   * A shop with no postal code at all is a third state and not this one, so it
   * is absent from every value of this filter rather than folded into `DERIVED`.
   */
  postalCodeSource?: PostalCodeSource;
}

/**
 * What the caller refuses, as the two reads below take it (plan 0068, section
 * 6, generalizing plan 0064).
 *
 * Catalog is handed the ids rather than asked to look them up: the refusals live
 * on a profile in core and the shops live here, and the gateway is what resolves
 * one and passes it to the other. Both lists are optional and an absent list is
 * an empty one, so a caller with nothing to refuse sends nothing.
 */
export interface ShopRefusals {
  /** Shops refused one by one. */
  excludedSupermarketLocationIds?: string[];
  /** Chains refused whole, which covers shops they open later. */
  excludedSupermarketIds?: string[];
}

/**
 * The chains with a shop in these postal codes (plan 0068, section 3.1).
 *
 * **The codes are the whole filter and they are required**: this read is keyed
 * by place, and a call naming no code answers no chains rather than the country.
 *
 * There is no country beside them, matching `priceScope.resolve`, which is the
 * other read the same postal codes are passed to: a profile's codes reach the
 * gateway as bare strings and inventing a country here would have it disagree
 * with the scopes the same profile prices against.
 */
export interface SummarizeLocationsByChainRequest extends ShopRefusals {
  userId: string;
  postalCodes: string[];
  /**
   * Whether a chain the caller refused whole gets a row.
   *
   * Only the **rows** are governed here, never the counts: `locations` and
   * `excluded` are over every shop in the codes either way, because a button
   * that reads "some refused" is counting exactly the shops a filtered count
   * would have dropped. Default false, because every other caller is offering a
   * shop rather than editing an opinion about one.
   */
  includeExcluded?: boolean;
}

/**
 * A page of shops in these postal codes (plan 0068, section 3.2).
 *
 * The three ways it is called, all of them one subject:
 *
 * - no `query`, `supermarketId` set: one franchise's shops near the caller
 * - `query` set, no `supermarketId`: the search bar, which searches **across**
 *   franchises on purpose
 * - both: a search within a franchise, which no screen asks for today and costs
 *   nothing to allow
 */
export interface SearchShopsRequest extends PageQuery, ShopRefusals {
  userId: string;
  postalCodes: string[];
  /** One chain's shops, rather than every chain's. */
  supermarketId?: string;
  /**
   * A typed word, matched case insensitively against the shop's label, its
   * chain's name in **any** locale, its address, its city and its postal code
   * (plan 0068, section 5). Absent lists rather than searches.
   */
  query?: string;
  /**
   * Whether shops the caller refused are in the page, flagged (plan 0068,
   * section 6). Default false: they are absent, because the reads that offer a
   * shop must not offer a refused one. The screen that edits those choices is
   * the caller that asks for them.
   *
   * A refused **chain**'s shops follow the same flag, carrying
   * {@link ShopView.excludedChain}, because that is the control a person needs
   * in order to change their mind.
   */
  includeExcluded?: boolean;
}

// --- Item requests ---------------------------------------------------------

export interface CreateItemRequest extends AdminCredential {
  name: LocalizedText;
  brand?: string | null;
  imageUrl?: string | null;
  sku?: string | null;
  ean?: string | null;
  unitSize?: number | null;
  category: ItemCategory;
  defaultUnit: UnitOfMeasure;
  /** Assign the product to a group (plan 0048). Owner curation, never automatic. */
  productGroupId?: string | null;
}

export interface UpdateItemRequest extends AdminCredential {
  itemId: string;
  name?: LocalizedText;
  brand?: string | null;
  imageUrl?: string | null;
  sku?: string | null;
  ean?: string | null;
  unitSize?: number | null;
  category?: ItemCategory;
  defaultUnit?: UnitOfMeasure;
  /** Assign, reassign or (with `null`) unassign the product's group (plan 0048). */
  productGroupId?: string | null;
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

export interface ItemIdRequest extends AdminCredential {
  itemId: string;
}

/** How many products one {@link ITEM_PATTERNS.getMany} may name. */
export const ITEM_LOOKUP_LIMITS = {
  /**
   * Comfortably above a basket's worth of picks and options, and low enough that
   * the request stays one bounded `IN` clause rather than an unbounded one.
   */
  maxIds: 500,
} as const;

/**
 * Several products by id (plan 0051, section 6.1).
 *
 * **No `userId`, deliberately**, which is the one place this departs from every
 * other catalog read. A product's name is not private: `0051` section 6.1 is
 * explicit that a line's options are catalog products and never zone data, and
 * this exists so a **guest** holding a shared basket can read the name of the
 * thing they are being asked to buy. The caller that reaches it is the gateway,
 * on behalf of a participant it has already authorized against the basket.
 */
export interface GetItemsRequest {
  /** At most {@link ITEM_LOOKUP_LIMITS.maxIds}. Duplicates are harmless. */
  ids: string[];
  /**
   * Price the results at these scopes (plan 0066, section 2). Absent leaves
   * `bestOffer` absent, as it always was.
   *
   * **Absent and empty are the same here.** A lookup by id returns the same
   * items either way, so the only question is whether a price is attached, and
   * one branch answers it. Plan 0069 made that the rule for every catalog read
   * rather than this one's exception.
   */
  priceScopeIds?: string[];
}

/**
 * The products that exist, in no promised order.
 *
 * Ids that name nothing are **absent** rather than null: a basket can outlive a
 * product catalog has since deleted, which is an ordinary thing for a history to
 * contain, so the caller matches by id and draws a line with no product name
 * rather than being handed an error for the whole page.
 */
export interface GetItemsResult {
  items: ItemView[];
}

export interface SearchItemsRequest extends PageQuery {
  userId: string;
  query?: string;
  category?: ItemCategory;
  /** Only this group's members (plan 0048). What "show me every milk" asks. */
  productGroupId?: string;
  /**
   * Only the products belonging to no group at all (plan 0073, section 4).
   *
   * The one filter the back office needs that a shopper never would: an
   * ungrouped product is invisible to every "show me milk" read, so this is how
   * the operator finds the ones curation has not reached. It is a separate flag
   * rather than a null {@link productGroupId} because absent already means "any
   * group", and a filter cannot spell "no group" by leaving itself out.
   *
   * `false` is the same as absent. Setting it beside a `productGroupId` asks for
   * the members of a group that have no group, which is nothing, and the service
   * answers exactly that rather than picking one of the two.
   */
  withoutProductGroup?: boolean;
  /**
   * Price the results, from these scopes and no others (plan 0048, section 3.1).
   *
   * **Absent and empty are the same answer since plan 0069, section 2**: the
   * catalog is ranked and paged as usual and every price field comes back null.
   * They were different for a while, an empty array answering an empty page, and
   * that read as "there is no milk" to somebody who had merely refused every
   * shop near them. A scope is how a price gets attached to a product, so having
   * none says nothing about which products exist. Which of the three priceless
   * states the caller is in is read from `coverage` on the scope view.
   */
  priceScopeIds?: string[];
}

/**
 * Rank groups for a bare word, and price each one (plan 0048, section 3).
 *
 * It takes the same scope set as {@link SearchItemsRequest} and reads it the same
 * way: with scopes or without, it ranks and pages, and without them every price
 * field is null (plan 0069, section 2).
 */
export interface SearchOffersRequest extends PageQuery {
  userId: string;
  query?: string;
  priceScopeIds?: string[];
}

// --- Product group requests ------------------------------------------------

export interface CreateProductGroupRequest extends AdminCredential {
  name: LocalizedText;
  slug: string;
  referenceUnit: UnitOfMeasure;
  synonyms?: LocalizedSynonyms;
}

export interface UpdateProductGroupRequest extends AdminCredential {
  productGroupId: string;
  name?: LocalizedText;
  slug?: string;
  referenceUnit?: UnitOfMeasure;
  synonyms?: LocalizedSynonyms;
}

export interface ProductGroupIdRequest extends AdminCredential {
  productGroupId: string;
}

export interface ListProductGroupsRequest extends PageQuery {
  userId: string;
  /** Free text over the group's own name and synonyms. Absent lists them all. */
  query?: string;
}

// --- Supermarket item requests ---------------------------------------------

/**
 * Write one price for one item in one scope. Called by hand through the gateway
 * it sets `priceSourceKind` to ADMIN and **pins** the row: section 6.5's rule is
 * that an automated fetch will not overwrite it afterwards.
 */
export interface UpsertSupermarketItemRequest extends AdminCredential {
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
export interface UpsertSupermarketItemBatchRequest extends AdminCredential {
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

export interface SupermarketItemIdRequest extends AdminCredential {
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

/**
 * The back office's price list (plan 0073, section 4). Every filter is optional
 * and an empty request pages the whole table, newest first.
 *
 * It carries an {@link AdminCredential} although it reads nothing a catalog read
 * does not already expose. That is deliberate and it is the point of the
 * namespace: the answer is unscoped and unranked, which is wrong for a shopper
 * and is the only useful shape for somebody looking for the row they just broke,
 * so it is reachable by an operator token and by nothing else.
 */
export interface AdminListSupermarketItemsRequest
  extends PageQuery, AdminCredential {
  /** One product's prices across every scope. */
  itemId?: string;
  /** One scope's prices, which is what a chain's price table is. */
  priceScopeId?: string;
  /**
   * `ADMIN` answers "what have I overridden", which plan 0038 section 6.5 makes
   * permanent and invisible and which nothing else can currently ask.
   */
  priceSourceKind?: PriceSourceKind;
  /** The scope wide flag, not the per store override on `SupermarketLocationItem`. */
  available?: boolean;
}

// --- Price scope requests --------------------------------------------------

export interface CreatePriceScopeRequest extends AdminCredential {
  supermarketId: string;
  kind: PriceScopeKind;
  externalKey?: string | null;
  label?: LocalizedText | null;
}

export interface UpdatePriceScopeRequest extends AdminCredential {
  priceScopeId: string;
  kind?: PriceScopeKind;
  externalKey?: string | null;
  label?: LocalizedText | null;
}

export interface PriceScopeIdRequest extends AdminCredential {
  priceScopeId: string;
}

export interface ListPriceScopesRequest extends PageQuery {
  userId: string;
  supermarketId?: string;
}

// --- Resolving a place into scopes (plan 0049, sections 1.1 and 3.1) --------

/**
 * "These postal codes, these chains, not those chains." Every field is optional
 * and a request with nothing positive in it resolves to nothing: no scopes, and
 * no `coverage` either, since coverage is one row per postal code asked about.
 * The gateway short circuits that case rather than sending it, because the
 * answer is known without a round trip, and it is a legitimate answer rather
 * than a failure (plan 0069, section 2).
 */
export interface ResolvePriceScopesRequest {
  userId: string;
  /** Stored exactly as typed, resolved here, never stored resolved. */
  postalCodes?: string[];
  /** The chains the caller listed. Empty means every chain serving the codes. */
  supermarketIds?: string[];
  /** Chains to leave out, applied after the two above. */
  excludedSupermarketIds?: string[];
  /**
   * Individual shops to leave out of rung one (plan 0064, section 3).
   *
   * The finer axis beside `excludedSupermarketIds`, and it narrows a different
   * step: a chain exclusion drops the chain from the candidates, this drops the
   * shops from the set that answers "who sits in these postal codes". Without it
   * exclusion would be cosmetic, because a caller could refuse every Mercadona
   * near them and still be quoted Mercadona's local price.
   *
   * It never re admits anything: a shop of an excluded chain stays excluded
   * whatever this list says, which is section 2.1's precedence.
   */
  excludedSupermarketLocationIds?: string[];
}

/**
 * How a scope was arrived at (plan 0049, section 3.1).
 *
 * A plain string union rather than an entry in `catalog.enums`, like
 * {@link CATALOG_SUGGESTION_KINDS}: nothing stores it and no column has its type.
 * It exists so a client can explain a price rather than merely show it.
 */
export const SCOPE_ORIGINS = [
  /** A store of that chain sits in one of the caller's postal codes. */
  'POSTAL_CODE',
  /** The chain prices nationally, so location does not enter into it. */
  'NATIONAL',
  /** The owner set fallback. Approximate, and says so. */
  'CHAIN_DEFAULT',
] as const;
export type ScopeOrigin = (typeof SCOPE_ORIGINS)[number];

/** One resolved scope, and the reason it is in the answer. */
export interface ResolvedScopeView {
  priceScopeId: string;
  supermarketId: string;
  /** The caller's postal code that reached it, or null off the other rungs. */
  postalCode: string | null;
  origin: ScopeOrigin;
  /** True exactly when `origin` is `CHAIN_DEFAULT`: prices are for elsewhere. */
  approximate: boolean;
}

/**
 * Whether we know of anybody serving one postal code (plan 0049, section 5).
 *
 * A code no chain serves is **accepted and flagged, never rejected**: coverage is
 * a property of our data and not of the user's address, and refusing the code
 * would tell somebody they live nowhere.
 */
export interface PostalCodeCoverageView {
  postalCode: string;
  served: boolean;
}

/** What a place resolves to today. */
export interface ResolvedScopesView {
  /** The union, ready to hand to a scoped read. Order is not significant. */
  priceScopeIds: string[];
  scopes: ResolvedScopeView[];
  /** One entry per postal code asked about, in the order they were given. */
  coverage: PostalCodeCoverageView[];
  /** True when any scope came off the last rung. */
  approximate: boolean;
}

/**
 * What the gateway's `GET /v1/catalog/scope` answers (plan 0049, sections 3 and
 * 5).
 *
 * A gateway shape written in `contracts` for the same reason
 * {@link CatalogSuggestResponse} is: it is assembled from two services and the
 * one place its halves can reference the same `ResolvedScopeView` is here.
 *
 * It exists because the flags have to reach a client and a page cannot carry
 * them: `ItemPage` is bare by house rule, and wrapping it to hang two booleans
 * off would change every catalog read's response shape. So the ladder's outcome
 * is described once, here, and a client that wants to say "prices shown for
 * Madrid" or "no chain we know reaches 12345" reads it beside its search.
 */
export interface CatalogScopeView extends ResolvedScopesView {
  /** The profile that supplied the selector, or null when the caller stated one. */
  profileId: string | null;
  /**
   * Whether the caller's own query decided the scopes. False means the default
   * (or named) profile was resolved, which is what an unscoped read does.
   */
  explicit: boolean;
}

/**
 * What the gateway's `GET /v1/catalog/shops/summary` answers (plan 0068,
 * section 3.1): one franchise button, ready to draw.
 *
 * A gateway shape in `contracts` for the reason {@link CatalogScopeView} is, and
 * this one is the plainest case of it: the two counts come from catalog, which
 * alone knows which shop belongs to which chain, and
 * {@link ShopChainSummaryView.excludedChain} comes from core, which alone knows
 * what the caller said. Neither service learns the other's domain and the
 * gateway is what puts them in one row.
 */
export interface ShopChainSummaryView extends SupermarketLocationChainSummaryView {
  /**
   * The caller refused the chain itself, which is a durable statement about the
   * brand and covers shops it opens later. Different from having refused every
   * shop currently listed, and the reason the franchise button has three states
   * rather than two.
   */
  excludedChain: boolean;
}

export interface ShopChainSummariesView {
  chains: ShopChainSummaryView[];
}

// --- Supermarket location item requests ------------------------------------

export interface UpsertSupermarketLocationItemRequest extends AdminCredential {
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
/** The browsed read of the same table (plan 0068), chain attached and refusals flagged. */
export type ShopPage = Paginated<ShopView>;
export type ItemPage = Paginated<ItemView>;
export type SupermarketItemPage = Paginated<SupermarketItemView>;
export type PriceScopePage = Paginated<PriceScopeView>;
export type SupermarketLocationItemPage =
  Paginated<SupermarketLocationItemView>;
export type ProductGroupPage = Paginated<ProductGroupView>;
export type ProductGroupOfferPage = Paginated<ProductGroupOfferView>;

// --- The composer's one call (plan 0048, section 3) -------------------------

/**
 * What a suggestion is (plan 0048, section 3).
 *
 * A plain string union rather than an entry in `catalog.enums`, like
 * {@link ITEM_ORDERS} beside it: nothing stores this, no column has its type, and
 * it exists only to tell two shapes apart in one response array.
 */
export const CATALOG_SUGGESTION_KINDS = ['group', 'item'] as const;
export type CatalogSuggestionKind = (typeof CATALOG_SUGGESTION_KINDS)[number];

/**
 * One row of the composer's dropdown. Exactly one of `group` and `item` is set,
 * and `kind` says which.
 */
export interface CatalogSuggestion {
  kind: CatalogSuggestionKind;
  group: ProductGroupOfferView | null;
  item: ItemView | null;
}

/**
 * The whole dropdown, in the order it is to be drawn (plan 0048, section 3).
 *
 * **One ordered array and not two lists**, because the rule it carries is an
 * ordering: a group beats an item for a bare word, velista `0043` section 6
 * states it from the client side and backlog `0004` section 1.2 states it as a
 * hard one. Handing a client `{ groups, items }` would leave the rule to the
 * client to reassemble, and a client that got it wrong would look right.
 */
export interface CatalogSuggestResponse {
  suggestions: CatalogSuggestion[];
}

/**
 * Orders a caller may choose for the catalog collections (plan 0012).
 *
 * `relevance` arrived with plan 0048 and is the **default when a query is
 * given**, which is what makes the search a search. With no query there is
 * nothing to be relevant to, so the default stays `name` and the admin surface's
 * listing is unchanged.
 */
export const ITEM_ORDERS = ['relevance', 'name', 'created', 'updated'] as const;
export type ItemOrder = (typeof ITEM_ORDERS)[number];

export const PRODUCT_GROUP_ORDERS = [
  'relevance',
  'name',
  'created',
  'updated',
] as const;
export type ProductGroupOrder = (typeof PRODUCT_GROUP_ORDERS)[number];

export const SUPERMARKET_ORDERS = ['name', 'created', 'updated'] as const;
export type SupermarketOrder = (typeof SUPERMARKET_ORDERS)[number];

// --- Postal code geography (plan 0060) --------------------------------------

/**
 * Two reads over the postal code centroids catalog ships (plan 0060,
 * sections 5 and 7).
 *
 * **Internal to the backend.** Nothing user facing calls either directly: core
 * asks `nearby` when it widens a profile (plan 0062), and `nearest` reaches a
 * device through a core route that plan 0058 defines. A gateway route here
 * would be a geocoding service nobody asked for, so there is none, and neither
 * request carries a `userId`.
 *
 * Both answer from a shipped table, not a network: no rate limit, no third
 * party, and a device's coordinates never leave our own process.
 */
export const POSTAL_CODE_PATTERNS = {
  /** Which postal code is this point in, if any centroid is close enough. */
  nearest: 'postalCode.nearest',
  /** Which postal codes have their centroid within a radius of this one. */
  nearby: 'postalCode.nearby',
} as const;

/** A postal code and how far its centroid is from what was asked about. */
export interface PostalCodeDistanceView {
  postalCode: string;
  distanceMetres: number;
}

export interface ResolveNearestPostalCodeRequest {
  /** ISO 3166-1 alpha-2, lowercase. Only `es` ships today. */
  country: string;
  latitude: number;
  longitude: number;
  /**
   * Beyond this the answer is null rather than a confident wrong code (plan
   * 0060, section 6): the nearest centroid to somebody at the edge of a large
   * rural code may belong to the neighbouring one. Configuration, not a
   * constant; plan 0062 owns the default.
   */
  maxDistanceMetres: number;
}

/**
 * **Approximate**: a centroid, never a boundary. A client shows the resolved
 * code for confirmation rather than adopting it silently.
 */
export interface NearestPostalCodeView {
  country: string;
  nearest: PostalCodeDistanceView | null;
}

export interface ListNearbyPostalCodesRequest {
  /** ISO 3166-1 alpha-2, lowercase. */
  country: string;
  /** The code to measure from; the answer never includes it. */
  postalCode: string;
  radiusMetres: number;
}

/**
 * Centroid to centroid, so two adjacent codes whose centres sit further apart
 * than the radius are neighbours in reality and not here. Acceptable for
 * widening a net a little, unacceptable as a statement about geography.
 */
export interface NearbyPostalCodesView {
  country: string;
  postalCode: string;
  /**
   * Whether the code asked about is in the table at all. An unknown code gets
   * an empty answer too, and a caller that wants to tell "nothing within 2 km"
   * from "we have no idea where this is" reads this.
   */
  known: boolean;
  /** Nearest first, never the code asked about. Empty when nothing is in range. */
  postalCodes: PostalCodeDistanceView[];
}

/**
 * Do we have any shops in these codes (plan 0063, section 5)?
 *
 * Several codes in one request because one profile write announces several: a
 * code with `expandNearby` set adds a parent and its neighbours at once, and
 * asking one at a time would be six round trips to answer one event.
 *
 * **No `userId`.** Every other catalog write and admin read carries one; this is
 * a count over a table catalog already serves openly, asked service to service,
 * and naming a user would put an account id on the path to a queue row that
 * outlives the request by a month.
 */
export interface CountLocationsByPostalCodeRequest {
  /** ISO 3166-1 alpha-2, lowercase. Every code in one request shares it. */
  country: string;
  postalCodes: string[];
}

/** One code and how many locations catalog holds in it. */
export interface PostalCodeLocationCount {
  postalCode: string;
  locations: number;
}

/**
 * One entry per code asked about, including the ones with no shops: a caller
 * deciding what is unknown needs the zeros, which is the whole point of asking.
 */
export interface PostalCodeLocationCountsView {
  country: string;
  counts: PostalCodeLocationCount[];
}

// --- The postal code table, for the back office (plan 0074) ------------------

/**
 * Read the shipped centroid table itself (plan 0074, section 2).
 *
 * The two reads above answer geography questions and neither can show an
 * operator what is in the table, which is the question the back office asks:
 * which codes do we hold, and which of them have a shop in them. So this is a
 * listing rather than a third distance query, and unlike its neighbours it
 * carries an {@link AdminCredential}: the centroids are reference data, but a
 * page of them ordered for administration is a back office screen.
 */
export const ADMIN_POSTAL_CODE_PATTERNS = {
  list: 'adminPostalCode.list',
} as const;

export type AdminPostalCodePattern =
  (typeof ADMIN_POSTAL_CODE_PATTERNS)[keyof typeof ADMIN_POSTAL_CODE_PATTERNS];

/**
 * One shipped postal code, with the number of shops catalog knows in it.
 *
 * `locationCount` is the answer to "does anything serve this code", counted the
 * same way `supermarketLocation.countByPostalCode` counts it, so the back office
 * and the profile widening path cannot disagree about whether a code is covered.
 */
export interface AdminPostalCodeView {
  /** ISO 3166-1 alpha-2, lowercase. */
  country: string;
  postalCode: string;
  latitude: number;
  longitude: number;
  /** Supermarket locations whose `postalCode` is this one. Often zero. */
  locationCount: number;
}

/**
 * The filters of section 2: by code, and by whether anything serves them.
 *
 * `served` is the one worth being careful about. False means **zero** locations,
 * which is a great many of the codes in a shipped national table and is exactly
 * the set an operator looking for coverage gaps wants; true means at least one.
 * Omitting it is every code, which is the default because a listing that hid the
 * empty ones by default would make the gap invisible.
 */
export interface ListAdminPostalCodesRequest
  extends AdminCredential, PageQuery {
  /** ISO 3166-1 alpha-2, lowercase. Defaults to every country in the table. */
  country?: string;
  /** Prefix match on the code, which is how a person narrows a numeric code. */
  postalCode?: string;
  /** True for codes with at least one location, false for those with none. */
  served?: boolean;
}

export type AdminPostalCodePage = Paginated<AdminPostalCodeView>;
