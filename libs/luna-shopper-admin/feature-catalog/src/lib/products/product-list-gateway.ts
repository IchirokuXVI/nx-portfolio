import type {
  FilterValue,
  ResourceGateway,
  ResourcePage,
  ResourceQuery,
  ResourceRow,
  Wire,
} from '@portfolio/luna-shopper-admin/models';

/** The shown price of one product at one scope, as the gateway gives it. */
export type ScopePrice = Wire.CatalogAdminSupermarketItemView;

/**
 * The list filter that names the price scope the list shows prices at (admin
 * plan 0043, target 2). The same name the price read takes it under.
 */
export const PRICES_AT_FILTER = 'priceScopeId';

/**
 * The list filter that narrows the list to one state of the price at that
 * scope. It means nothing without {@link PRICES_AT_FILTER}.
 */
export const PRICE_STATE_FILTER = 'priceState';

/**
 * The filter of the product route that lists the products a scope has no
 * price for (backend plan 0187). The route takes the scope under this name
 * and not under {@link PRICES_AT_FILTER}, which it does not declare.
 */
export const WITHOUT_PRICE_FILTER = 'withoutPriceAtScopeId';

/**
 * The states of a price that the gateway can list products by.
 *
 * Two, and the plan names three:
 *
 * - **Out of date** (`stale`) is here: the price read takes `stale=true`.
 * - **No price** (`noPrice`) is here: the product read takes
 *   {@link WITHOUT_PRICE_FILTER} (backend plan 0187), and answers how many
 *   products match beside the page.
 * - **Not sold here** is not. The price read declares `available`, and it
 *   reads `available=false` as true: the validation pipe converts the text
 *   to a boolean before the route's own reading of it runs, and any text that
 *   is not empty converts to true. So the read answers the products that are
 *   sold. A state the gateway cannot answer is not drawn. A row still says
 *   "Not sold here", from the `available` the gateway gives on it.
 */
export const PRICE_STATES = ['stale', 'noPrice'] as const;

/**
 * `stale`: the shown price is out of date. `noPrice`: the scope shows no
 * price for the product, and does not say that it does not sell it.
 */
export type PriceState = (typeof PRICE_STATES)[number];

/** The states whose page is read from the prices and not from the products. */
type PriceReadState = Exclude<PriceState, 'noPrice'>;

/**
 * Whether the page of a state is read from the prices.
 *
 * Such a row names its product and carries nothing else of it, and no filter
 * of the product list reaches that read. "No price" is the other kind: its
 * rows are whole products, read from the product route, so every filter of
 * the list still applies to them.
 */
export function readsFromPrices(state: PriceState): state is PriceReadState {
  return state !== 'noPrice';
}

/** A typed value as a state, or `null` for anything else. */
export function toPriceState(value: unknown): PriceState | null {
  return (PRICE_STATES as readonly unknown[]).includes(value)
    ? (value as PriceState)
    : null;
}

/** What the price read is asked for each state. */
const STATE_FILTERS: Readonly<Record<PriceReadState, Record<string, string>>> =
  {
    stale: { stale: 'true' },
  };

/** The most products one price read may name, which the gateway enforces. */
export const PRICE_IDS_PER_READ = 100;

/**
 * What a product row gains when the list shows prices at a scope.
 *
 * - `scopePrice` absent: no scope was asked for.
 * - `scopePrice: null`: the scope holds no row for the product.
 * - `partial`: the row was read from the prices and not from the products, so
 *   it carries the product's id and name and none of its other fields.
 *
 * A type and not an interface, so that a row carrying it is still a row: an
 * interface has no index signature, and a resource row is read by name.
 */
export type ScopePriced = {
  readonly scopePrice?: ScopePrice | null;
  readonly partial?: true;
};

/**
 * The product list, able to show the price at one scope (admin plan 0043,
 * target 2).
 *
 * It is the product gateway, and it reads two more filters that are not the
 * product route's:
 *
 * - With a scope, each page of products is followed by **one** read of the
 *   prices of those products at that scope, and each row gains its
 *   `scopePrice`. One request per page, never one per row.
 * - With a scope and the state "Out of date", the page is read from the
 *   prices instead, since that is the read that can filter by that state.
 *   Those rows name the product and carry nothing else of it, and say so with
 *   `partial`.
 * - With a scope and the state "No price", the page is read from the products,
 *   narrowed by {@link WITHOUT_PRICE_FILTER} beside every other filter of the
 *   list. The page carries `total`, the number of products that match.
 *
 * Neither filter reaches the product route under its own name, which that
 * route does not declare and would refuse.
 *
 * Nothing here decides which price is shown. The row is the gateway's shown
 * price, as it gave it.
 */
export function productListGateway<
  T extends ResourceRow & { readonly id: string },
>(
  products: ResourceGateway<T>,
  prices: Pick<ResourceGateway<ScopePrice>, 'list'>
): ResourceGateway<T & ScopePriced> {
  return {
    list: async (query) => {
      const { scopeId, state, rest } = split(query.filters ?? {});

      if (scopeId === null) {
        return products.list({ ...query, filters: rest });
      }

      if (state === 'noPrice') {
        // The rows are whole products, and by the meaning of the state none
        // of them has a price to show at the scope. So no price is read, and
        // the count the route answered goes through with the page.
        const page = await products.list({
          ...query,
          filters: { ...rest, [WITHOUT_PRICE_FILTER]: scopeId },
        });
        return {
          ...page,
          items: page.items.map((row) => ({ ...row, scopePrice: null })),
        } satisfies ResourcePage<T & ScopePriced>;
      }

      if (state !== null) {
        const page = await prices.list({
          cursor: query.cursor,
          limit: query.limit,
          filters: { [PRICES_AT_FILTER]: scopeId, ...STATE_FILTERS[state] },
        });
        return {
          items: page.items.map((row) => fromPrice<T>(row)),
          nextCursor: page.nextCursor,
        };
      }

      const page = await products.list({ ...query, filters: rest });
      const priced = await pricesOf(
        prices,
        scopeId,
        page.items.map((row) => row.id)
      );

      return {
        items: page.items.map((row) => ({
          ...row,
          scopePrice: priced.get(row.id) ?? null,
        })),
        nextCursor: page.nextCursor,
      } satisfies ResourcePage<T & ScopePriced>;
    },
    // A product the list found by its ID (admin plan 0051) is drawn in the
    // same row as any other, so it carries the price at the chosen scope.
    // Without it the row would say "no price" about a product that has one.
    read: async (id, shown) => {
      const row = await products.read(id);
      const { scopeId } = split(shown ?? {});
      if (scopeId === null) {
        return row;
      }
      // The product was found, and that is what was asked. A price read that
      // fails must not turn it into "No product has this ID.", which is what
      // a 404 or a 400 thrown from here would be read as. So the row goes
      // back as the product route gave it, with no `scopePrice` at all: not
      // `null`, which would say the scope holds no price for it.
      try {
        const priced = await pricesOf(prices, scopeId, [row.id]);
        return { ...row, scopePrice: priced.get(row.id) ?? null };
      } catch {
        return row;
      }
    },
    create: (input) => products.create(input),
    update: (id, input) => products.update(id, input),
    remove: (id) => products.remove(id),
  };
}

/** The filters, with the two this gateway answers itself taken out. */
function split(filters: NonNullable<ResourceQuery['filters']>): {
  scopeId: string | null;
  state: PriceState | null;
  rest: Record<string, FilterValue>;
} {
  const rest: Record<string, FilterValue> = {};
  for (const [name, value] of Object.entries(filters)) {
    if (
      name !== PRICES_AT_FILTER &&
      name !== PRICE_STATE_FILTER &&
      // Only this gateway sets it, from the scope and the state.
      name !== WITHOUT_PRICE_FILTER
    ) {
      rest[name] = value;
    }
  }

  const scope = filters[PRICES_AT_FILTER];
  const scopeId = typeof scope === 'string' && scope !== '' ? scope : null;

  return {
    scopeId,
    state: scopeId === null ? null : toPriceState(filters[PRICE_STATE_FILTER]),
    rest,
  };
}

/**
 * The shown price of each named product at one scope, by product.
 *
 * One read for a page of products. A page larger than the gateway lets one
 * read name is split, which no page of this app is today.
 */
async function pricesOf(
  prices: Pick<ResourceGateway<ScopePrice>, 'list'>,
  scopeId: string,
  ids: readonly string[]
): Promise<ReadonlyMap<string, ScopePrice>> {
  const found = new Map<string, ScopePrice>();

  for (let from = 0; from < ids.length; from += PRICE_IDS_PER_READ) {
    const chunk = ids.slice(from, from + PRICE_IDS_PER_READ);
    const page = await prices.list({
      limit: PRICE_IDS_PER_READ,
      filters: { [PRICES_AT_FILTER]: scopeId, itemIds: chunk },
    });
    for (const row of page.items) {
      found.set(row.itemId, row);
    }
  }

  return found;
}

/** A row of the prices, as the least a product row can be. */
function fromPrice<T>(row: ScopePrice): T & ScopePriced {
  return {
    id: row.itemId,
    name: row.itemName ?? {},
    scopePrice: row,
    partial: true,
  } as unknown as T & ScopePriced;
}
