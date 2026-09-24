import { Injectable } from '@angular/core';
import type {
  CatalogBrowseContext,
  CatalogBrowseQuery,
  CatalogChain,
  CatalogPriceState,
  CatalogProduct,
  CatalogScopeOffer,
  Page,
  PriceUnitBasis,
  ProductCategory,
  ProductOffer,
  UnitOfMeasure,
} from '@portfolio/velista/models';
import type { CatalogBrowseServiceI } from './catalog-browse-service';

/**
 * The catalog tab with no backend. Asked for by name, never a default.
 *
 * Three chains near one postal code, one scope each, and a dozen products priced
 * unevenly across them: one chain does not sell the oil, one sells the bread with
 * no price, and one milk has a stale price. Those are the cases a row and the
 * sheet have to draw, so a fixture where every product was priced everywhere would
 * show nothing worth looking at.
 *
 * {@link state} switches the whole double into one of the priceless states, for a
 * spec or a backend-less run that wants the card: the products stay and every
 * price goes, because that is what the server does (velista `0069`, section 2).
 */
@Injectable()
export class CatalogBrowseMemory implements CatalogBrowseServiceI {
  /** Which state {@link context} reports. Everything but `priced` prices nothing. */
  state: CatalogPriceState = 'priced';

  async context(): Promise<CatalogBrowseContext | null> {
    const priced = this.state === 'priced';
    const hasCode = this.state !== 'noPlace';
    const chains: readonly CatalogChain[] =
      this.state === 'refused' || this.state === 'unserved' ? [] : CHAINS;

    return {
      state: this.state,
      postalCodes: hasCode ? ['14013'] : [],
      chains,
      scopes: priced
        ? CHAINS.map((chain) => ({
            priceScopeId: scopeOf(chain.supermarketId),
            supermarketId: chain.supermarketId,
          }))
        : [],
      chainNames: new Map(
        CHAINS.map((chain) => [chain.supermarketId, chain.name])
      ),
    };
  }

  /**
   * Narrowed, ordered and paged the way the server does it.
   *
   * The cursor is an offset, which the real one is not. Nothing reads it but this
   * class, and a keyset over a dozen rows would be ceremony.
   */
  async browse(
    query: CatalogBrowseQuery
  ): Promise<Page<CatalogProduct> | null> {
    const needle = query.query.trim().toLocaleLowerCase();
    const scopes =
      this.state !== 'priced'
        ? new Set<string>()
        : new Set(
            query.priceScopeIds.length > 0
              ? query.priceScopeIds
              : CHAINS.map((chain) => scopeOf(chain.supermarketId))
          );

    const matched = PRODUCTS.filter(
      (row) =>
        (needle === '' ||
          row.es.toLocaleLowerCase().includes(needle) ||
          row.en.toLocaleLowerCase().includes(needle)) &&
        (query.soldBy === null ||
          row.prices[query.soldBy as ChainKey] !== undefined)
    );

    const ordered =
      query.order === 'created'
        ? [...matched].reverse()
        : query.order === 'relevance'
          ? [...matched].sort(
              (a, b) =>
                Number(!startsWith(b, needle)) - Number(!startsWith(a, needle))
            )
          : [...matched].sort((a, b) => a.es.localeCompare(b.es, 'es'));

    const start = query.cursor === null ? 0 : Number(query.cursor);
    const page = ordered.slice(start, start + query.limit);
    const next = start + query.limit;

    return {
      items: page.map((row) => toProduct(row, scopes)),
      nextCursor: next < ordered.length ? String(next) : null,
    };
  }

  async scopeOffers(
    itemId: string
  ): Promise<readonly CatalogScopeOffer[] | null> {
    const row = PRODUCTS.find((product) => product.id === itemId);
    if (row === undefined) {
      return [];
    }

    return (Object.keys(row.prices) as ChainKey[]).map((chain) => ({
      offer: offerAt(row, chain),
      available: true,
    }));
  }
}

type ChainKey = 'chain-mercadona' | 'chain-deza' | 'chain-carrefour';

const CHAINS: readonly CatalogChain[] = [
  {
    supermarketId: 'chain-mercadona',
    name: { es: 'Mercadona', en: 'Mercadona' },
    locations: 7,
  },
  {
    supermarketId: 'chain-deza',
    name: { es: 'Deza', en: 'Deza' },
    locations: 3,
  },
  {
    supermarketId: 'chain-carrefour',
    name: { es: 'Carrefour', en: 'Carrefour' },
    locations: 2,
  },
];

interface Fixture {
  readonly id: string;
  readonly es: string;
  readonly en: string;
  readonly brand: string | null;
  readonly size: number | null;
  readonly unit: UnitOfMeasure;
  readonly category: ProductCategory;
  readonly basis: PriceUnitBasis | null;
  /** Price per chain. Null is stocked with no price, absent is not sold. */
  readonly prices: Partial<Record<ChainKey, number | null>>;
  readonly stale?: boolean;
}

const PRODUCTS: readonly Fixture[] = [
  fixture(
    'item-oil',
    'Aceite de oliva virgen extra',
    'Extra virgin olive oil',
    'Hacendado',
    1,
    'LITER',
    'PANTRY',
    'LITER',
    { 'chain-mercadona': 8.45, 'chain-deza': 8.95 }
  ),
  fixture(
    'item-rice',
    'Arroz redondo',
    'Short grain rice',
    'SOS',
    1,
    'KILOGRAM',
    'PANTRY',
    'KILOGRAM',
    { 'chain-mercadona': 1.35, 'chain-deza': 1.29, 'chain-carrefour': 1.39 }
  ),
  fixture(
    'item-tuna',
    'Atún claro en aceite, 3 x 80 g',
    'Light tuna in oil, 3 x 80 g',
    'Calvo',
    0.24,
    'KILOGRAM',
    'PANTRY',
    'KILOGRAM',
    { 'chain-mercadona': 2.79, 'chain-carrefour': 2.65 }
  ),
  fixture(
    'item-sugar',
    'Azúcar blanco',
    'White sugar',
    'Azucarera',
    1,
    'KILOGRAM',
    'PANTRY',
    'KILOGRAM',
    { 'chain-mercadona': 1.05, 'chain-deza': 1.15 }
  ),
  fixture(
    'item-coffee',
    'Café molido mezcla',
    'Ground coffee blend',
    'Marcilla',
    0.25,
    'KILOGRAM',
    'BEVERAGES',
    'KILOGRAM',
    { 'chain-deza': 2.19, 'chain-carrefour': 2.39 }
  ),
  fixture(
    'item-eggs',
    'Huevos frescos',
    'Fresh eggs',
    'Hacendado',
    12,
    'UNIT',
    'DAIRY',
    'DOZEN',
    { 'chain-mercadona': 2.2 }
  ),
  fixture(
    'item-milk',
    'Leche entera',
    'Whole milk',
    'Hacendado',
    1,
    'LITER',
    'DAIRY',
    'LITER',
    { 'chain-mercadona': 0.89, 'chain-deza': 0.95 }
  ),
  fixture(
    'item-milk-six',
    'Leche entera, 6 x 1 L',
    'Whole milk, 6 x 1 L',
    'Puleva',
    6,
    'LITER',
    'DAIRY',
    'LITER',
    { 'chain-carrefour': 6.42 }
  ),
  fixture(
    'item-milk-lactose',
    'Leche entera sin lactosa',
    'Lactose free whole milk',
    'Kaiku',
    1,
    'LITER',
    'DAIRY',
    'LITER',
    { 'chain-deza': 1.35 },
    true
  ),
  fixture(
    'item-bread',
    'Pan de molde integral',
    'Wholemeal sliced bread',
    'Bimbo',
    0.45,
    'KILOGRAM',
    'BAKERY',
    'KILOGRAM',
    { 'chain-mercadona': null, 'chain-carrefour': 1.99 }
  ),
  fixture(
    'item-yogurt',
    'Yogur natural, 4 x 125 g',
    'Plain yogurt, 4 x 125 g',
    'Danone',
    0.5,
    'KILOGRAM',
    'DAIRY',
    'KILOGRAM',
    { 'chain-mercadona': 1.1, 'chain-deza': 1.25, 'chain-carrefour': 1.19 }
  ),
  // Sold nowhere near 14013, which is an ordinary product in a national catalog.
  fixture(
    'item-gazpacho',
    'Gazpacho tradicional',
    'Traditional gazpacho',
    'Alvalle',
    1,
    'LITER',
    'PANTRY',
    'LITER',
    {}
  ),
];

function fixture(
  id: string,
  es: string,
  en: string,
  brand: string | null,
  size: number | null,
  unit: UnitOfMeasure,
  category: ProductCategory,
  basis: PriceUnitBasis | null,
  prices: Partial<Record<ChainKey, number | null>>,
  stale = false
): Fixture {
  return { id, es, en, brand, size, unit, category, basis, prices, stale };
}

function scopeOf(supermarketId: string): string {
  return `scope-${supermarketId}`;
}

function startsWith(row: Fixture, needle: string): boolean {
  return (
    row.es.toLocaleLowerCase().startsWith(needle) ||
    row.en.toLocaleLowerCase().startsWith(needle)
  );
}

/** Two days before the moment the double is read, so the seen line has an age. */
function observedAt(): Date {
  return new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
}

function offerAt(row: Fixture, chain: ChainKey): ProductOffer {
  const price = row.prices[chain] ?? null;
  return {
    price,
    currency: price === null ? null : 'EUR',
    unitPrice:
      price === null || row.size === null || row.size <= 0
        ? null
        : Math.round(
            (price / (row.basis === 'DOZEN' ? row.size / 12 : row.size)) * 100
          ) / 100,
    unitPriceLabel: null,
    observedAt: price === null ? null : observedAt(),
    sourceKind: 'OFFICIAL_API',
    stale: row.stale === true,
    priceScopeId: scopeOf(chain),
  };
}

function toProduct(row: Fixture, scopes: ReadonlySet<string>): CatalogProduct {
  let best: ProductOffer | null = null;
  for (const chain of Object.keys(row.prices) as ChainKey[]) {
    if (!scopes.has(scopeOf(chain))) {
      continue;
    }
    const offer = offerAt(row, chain);
    if (
      offer.price !== null &&
      (best === null || best.price === null || offer.price < best.price)
    ) {
      best = offer;
    }
  }

  return {
    id: row.id,
    name: { es: row.es, en: row.en },
    brand: row.brand,
    imageUrl: null,
    size: row.size,
    unit: row.unit,
    category: row.category,
    offer: best,
    unitBasis: best === null ? null : row.basis,
  };
}
