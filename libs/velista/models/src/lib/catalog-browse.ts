import type { ProductOffer } from './domain';
import type { ProductCategory, UnitOfMeasure } from './enums';
import {
  inLocale,
  type LocalizedName,
  type PostalCodeCoverage,
} from './shopping-profile';

/**
 * The orders the catalog tab offers (velista `0100`, section 2).
 *
 * Three of the server's four. `updated` is left out because nothing on the screen
 * could explain it to a shopper, and a price order is left out because the read has
 * none (section 8).
 */
export type CatalogOrder = 'relevance' | 'name' | 'created';

/**
 * A catalog name in the reader's language, or in the other one when it has only
 * that one.
 *
 * {@link inLocale} falls back to English, which is right for a name somebody
 * typed in both. Harvested names are not: most products and some chains carry
 * Spanish only, and an English reader would otherwise see a blank row where the
 * name should be. A name in the wrong language still names the product.
 */
export function catalogName(name: LocalizedName, locale: string): string {
  const own = inLocale(name, locale);
  if (own !== '') {
    return own;
  }
  return name.es !== '' ? name.es : name.en;
}

/**
 * Which pills the screen draws, in order (rule C2 of the mock).
 *
 * **Best match exists only while there is something to match.** That is the
 * server's own rule: the read defaults to relevance with a query and to name
 * without one, and relevance with no words is an arbitrary order wearing a
 * confident label.
 */
export function catalogOrdersFor(query: string): readonly CatalogOrder[] {
  return query.trim() === ''
    ? ['name', 'created']
    : ['relevance', 'name', 'created'];
}

/**
 * What a price per kilo or litre is counted in, as the source published it.
 *
 * Read off the wire so the row can say "/ L" without parsing `unitPriceLabel`,
 * which is text for a human and not a unit.
 */
export type PriceUnitBasis = 'KILOGRAM' | 'LITER' | 'UNIT' | 'DOZEN' | 'WASH';

export const PRICE_UNIT_BASES: readonly PriceUnitBasis[] = [
  'KILOGRAM',
  'LITER',
  'UNIT',
  'DOZEN',
  'WASH',
];

/**
 * One product on the catalog tab (from `catalog.ItemView`).
 *
 * Its own model rather than `CatalogItem` widened, because this is the one
 * screen that draws a picture and a price per unit, and a field added to the
 * composer's model is a field every fixture of it has to learn.
 */
export interface CatalogProduct {
  readonly id: string;
  readonly name: LocalizedName;
  readonly brand: string | null;
  /** Null draws the carton glyph. */
  readonly imageUrl: string | null;
  readonly size: number | null;
  readonly unit: UnitOfMeasure;
  readonly category: ProductCategory;
  /** The cheapest price at the scopes the read was given, or null. */
  readonly offer: ProductOffer | null;
  /** What {@link ProductOffer.unitPrice} is counted in, or null when unknown. */
  readonly unitBasis: PriceUnitBasis | null;
}

/** What one browse read asks for. */
export interface CatalogBrowseQuery {
  /** Blank is no query, and lists the whole catalog. */
  readonly query: string;
  readonly order: CatalogOrder;
  /** Only the products this chain sells (backend `0146`), or every chain. */
  readonly soldBy: string | null;
  /**
   * Price from exactly these scopes. Empty resolves the caller's own profile,
   * which is what every read without a chain chosen wants.
   */
  readonly priceScopeIds: readonly string[];
  readonly cursor: string | null;
  readonly limit: number;
}

/**
 * Why the catalog is, or is not, priced for this person (velista `0069`, section 2).
 *
 * - `priced`: the read resolves to at least one price scope.
 * - `noPlace`: no postal code, so nothing can be priced.
 * - `unserved`: postal codes, and no chain we know reaches any of them.
 * - `refused`: postal codes that are served, and every chain in them refused.
 * - `unpriced`: none of those, and still no scope. Drawn with no card.
 *
 * None of these is an empty catalog. Every one lists every product.
 */
export type CatalogPriceState =
  | 'priced'
  | 'noPlace'
  | 'unserved'
  | 'refused'
  | 'unpriced';

/** One chain near the person, as the chip row draws it. */
export interface CatalogChain {
  readonly supermarketId: string;
  readonly name: LocalizedName;
  /** How many of its shops are in the person's postal codes. */
  readonly locations: number;
}

/** One price scope the person's read resolves to, and whose it is. */
export interface CatalogScopeChain {
  readonly priceScopeId: string;
  readonly supermarketId: string;
}

/**
 * Everything the catalog tab needs besides the products: where the person
 * shops, which chains that is, and which scope belongs to which chain.
 */
export interface CatalogBrowseContext {
  readonly state: CatalogPriceState;
  /** The person's postal codes, in the order the profile holds them. */
  readonly postalCodes: readonly string[];
  /** The chip row, in the order the server returned it. */
  readonly chains: readonly CatalogChain[];
  readonly scopes: readonly CatalogScopeChain[];
  /** Every chain's name the app knows, for naming a scope that is not a chip. */
  readonly chainNames: ReadonlyMap<string, LocalizedName>;
}

/**
 * Which priceless state a read is in, from `GET /v1/catalog/scope` and the chains
 * near the person.
 *
 * The order of the checks is the order of the causes: a person with no code
 * cannot have refused anything, and a code nobody serves has no chain to refuse.
 */
export function catalogPriceState(
  priceScopeIds: readonly string[],
  coverage: readonly PostalCodeCoverage[],
  chains: readonly CatalogChain[]
): CatalogPriceState {
  if (priceScopeIds.length > 0) {
    return 'priced';
  }
  if (coverage.length === 0) {
    return 'noPlace';
  }
  if (!coverage.some((code) => code.served)) {
    return 'unserved';
  }
  return chains.length === 0 ? 'refused' : 'unpriced';
}

/** The scopes one chain prices from, for the read a chip makes. */
export function scopesOfChain(
  context: CatalogBrowseContext,
  supermarketId: string
): readonly string[] {
  return context.scopes
    .filter((scope) => scope.supermarketId === supermarketId)
    .map((scope) => scope.priceScopeId);
}

/** The chain a price scope belongs to, or null when the read did not resolve it. */
export function chainOfScope(
  context: CatalogBrowseContext,
  priceScopeId: string
): string | null {
  return (
    context.scopes.find((scope) => scope.priceScopeId === priceScopeId)
      ?.supermarketId ?? null
  );
}

/**
 * One source row for a product (from `catalog.SupermarketItemView`): a scope, the
 * price there, and whether the chain stocks it at all.
 */
export interface CatalogScopeOffer {
  readonly offer: ProductOffer;
  readonly available: boolean;
}

/** One line of the product sheet: a chain near the person, and what it charges. */
export interface ProductShopPrice {
  readonly supermarketId: string;
  readonly chain: LocalizedName;
  /**
   * `priced` has a price, `unpriced` stocks it with no price anybody saw, and
   * `notSold` has no available row at any of the person's scopes.
   */
  readonly kind: 'priced' | 'unpriced' | 'notSold';
  /** The cheapest priced offer, or the unpriced one. Null for `notSold`. */
  readonly offer: ProductOffer | null;
  /** True on the one cheapest line, and only when it has a price. */
  readonly cheapest: boolean;
}

/**
 * Every chain near the person and what it charges for one product (velista
 * `0100`, section 5), cheapest first.
 *
 * Only the person's own scopes count. The source rows come from every scope in the
 * country, and a price in a town somebody never shops in is not their price.
 *
 * A chain is named once, at its cheapest scope, because the question the sheet
 * answers is "what does this cost at Mercadona", not "at which warehouse". Priced
 * chains come first by price, then chains that stock it with no price, then the
 * chains near the person that do not sell it. A chain the read resolved a scope
 * for that is not a chip is still listed, named from {@link CatalogBrowseContext.chainNames}.
 */
export function productShopPrices(
  rows: readonly CatalogScopeOffer[],
  context: CatalogBrowseContext
): readonly ProductShopPrice[] {
  const best = new Map<string, ProductOffer>();

  for (const row of rows) {
    if (!row.available) {
      continue;
    }
    const chain = chainOfScope(context, row.offer.priceScopeId);
    if (chain === null) {
      continue;
    }
    const held = best.get(chain);
    if (held === undefined || cheaper(row.offer, held)) {
      best.set(chain, row.offer);
    }
  }

  const stocked: ProductShopPrice[] = [];
  for (const [supermarketId, offer] of best) {
    const chain = nameOf(context, supermarketId);
    // A chain nobody can name is skipped rather than drawn blank, which is the
    // rule the basket's cheapest elsewhere already follows.
    if (chain !== null) {
      stocked.push({
        supermarketId,
        chain,
        kind: offer.price === null ? 'unpriced' : 'priced',
        offer,
        cheapest: false,
      });
    }
  }
  stocked.sort(byPrice);

  const notSold: ProductShopPrice[] = context.chains
    .filter((chain) => !best.has(chain.supermarketId))
    .map((chain) => ({
      supermarketId: chain.supermarketId,
      chain: chain.name,
      kind: 'notSold',
      offer: null,
      cheapest: false,
    }));

  const lines = [...stocked, ...notSold];
  const first = lines[0];
  if (first !== undefined && first.kind === 'priced') {
    lines[0] = { ...first, cheapest: true };
  }
  return lines;
}

/**
 * The newest moment any priced line was seen, for the sheet's foot.
 *
 * The newest rather than the cheapest's, because the sentence is about how far
 * behind the shelf the whole sheet can be, and it says "a price can be behind".
 */
export function productPricesSeenAt(
  lines: readonly ProductShopPrice[]
): Date | null {
  let newest: Date | null = null;
  for (const line of lines) {
    const seen = line.offer?.observedAt ?? null;
    if (seen !== null && (newest === null || seen > newest)) {
      newest = seen;
    }
  }
  return newest;
}

function cheaper(offer: ProductOffer, than: ProductOffer): boolean {
  if (offer.price === null) {
    return false;
  }
  return than.price === null || offer.price < than.price;
}

function byPrice(a: ProductShopPrice, b: ProductShopPrice): number {
  const left = a.offer?.price ?? null;
  const right = b.offer?.price ?? null;
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return left - right;
}

function nameOf(
  context: CatalogBrowseContext,
  supermarketId: string
): LocalizedName | null {
  return (
    context.chains.find((chain) => chain.supermarketId === supermarketId)
      ?.name ??
    context.chainNames.get(supermarketId) ??
    null
  );
}
