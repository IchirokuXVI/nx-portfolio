import { computed, inject, Injectable, signal } from '@angular/core';
import {
  CATALOG_BROWSE_SERVICE,
  GroupMembers,
  ItemNames,
  type CatalogBrowseServiceI,
} from '@portfolio/velista/data-access';
import {
  compareGroupOffers,
  type CatalogItem,
  type ProductChoicePrice,
  type ProductOffer,
} from '@portfolio/velista/models';

/** What the sheet asks for: these products, priced at these scopes. */
export interface ChangeChoicesQuery {
  /** The product chosen now, the products of the lines, a product picked. */
  readonly itemIds: readonly string[];
  /** Where to price them, see `changePriceScopes`. */
  readonly priceScopeIds: readonly string[];
  /** Whether the basket is read at a shop, which is what "Not sold here" needs. */
  readonly atShop: boolean;
}

type ChoicesState = 'loading' | 'ready' | 'failed';

const NO_PRICE: ProductChoicePrice = { kind: 'noPrice' };
const NOT_SOLD: ProductChoicePrice = { kind: 'notSold' };

/**
 * The products the change sheet offers, named and priced (velista `0140`,
 * section 2).
 *
 * The read of the basket names one product for each row (backend `0201`,
 * section 3), so the sheet reads the rest itself, in three steps:
 *
 * 1. **The names**, through `ItemNames`, which also says which group each
 *    product is in.
 * 2. **The members of those groups**, through `GroupMembers`, priced at the
 *    scopes asked for. A member's price comes with it.
 * 3. **The price of every other product**, from its offers at every scope, kept
 *    to the scopes asked for. At a shop, a product with no offer there is not
 *    sold there.
 *
 * Any of them failing fails the whole read, which the sheet draws as one row with
 * a retry: a list priced on half of its products would order them wrong.
 *
 * Provided by the sheet, so its answers go with it.
 */
@Injectable()
export class ChangeChoices {
  private readonly _names = inject(ItemNames);
  private readonly _groups = inject(GroupMembers);
  private readonly _browse = inject<CatalogBrowseServiceI>(
    CATALOG_BROWSE_SERVICE
  );

  private readonly _state = signal<ChoicesState>('loading');
  private readonly _members = signal<readonly CatalogItem[]>([]);
  private readonly _prices = signal<ReadonlyMap<string, ProductChoicePrice>>(
    new Map()
  );
  private _query: ChangeChoicesQuery | null = null;
  private _generation = 0;

  readonly state = this._state.asReadonly();

  /** The members of the groups of the products asked for, in the order read. */
  readonly memberIds = computed(() =>
    this._members().map((member) => member.id)
  );

  /** One product, from the names read or the members, or null when not read. */
  itemOf(itemId: string): CatalogItem | null {
    return (
      this._names.nameOf(itemId) ??
      this._members().find((member) => member.id === itemId) ??
      null
    );
  }

  /** What one product costs where the sheet prices, once it is read. */
  readonly priceOf = (itemId: string): ProductChoicePrice =>
    this._prices().get(itemId) ?? { kind: 'loading' };

  /** Read these products. The same query twice reads once. */
  async load(query: ChangeChoicesQuery): Promise<void> {
    if (
      this._query !== null &&
      this._state() !== 'failed' &&
      sameQuery(this._query, query)
    ) {
      return;
    }
    this._query = query;
    const generation = ++this._generation;
    this._state.set('loading');

    const answer = await this._read(query);
    if (generation !== this._generation) {
      return;
    }
    if (answer === null) {
      this._state.set('failed');
      return;
    }
    this._members.set(answer.members);
    this._prices.set(answer.prices);
    this._state.set('ready');
  }

  /** The read again, after a failure. */
  async retry(): Promise<void> {
    const query = this._query;
    if (query !== null) {
      this._query = null;
      await this.load(query);
    }
  }

  private async _read(query: ChangeChoicesQuery): Promise<{
    readonly members: readonly CatalogItem[];
    readonly prices: ReadonlyMap<string, ProductChoicePrice>;
  } | null> {
    const itemIds = [...new Set(query.itemIds)];
    await this._names.ensure(itemIds);
    if (this._names.anyFailed(itemIds)) {
      return null;
    }

    const groupIds = [
      ...new Set(
        itemIds
          .map((itemId) => this._names.nameOf(itemId)?.productGroupId ?? null)
          .filter((groupId): groupId is string => groupId !== null)
      ),
    ];
    const scope = { priceScopeIds: query.priceScopeIds };
    await this._groups.ensure(groupIds, scope);
    const members: CatalogItem[] = [];
    for (const groupId of groupIds) {
      const read = this._groups.membersOf(groupId, scope);
      if (read === null) {
        return null;
      }
      members.push(...read);
    }

    const prices = new Map<string, ProductChoicePrice>();
    for (const member of members) {
      if (!prices.has(member.id)) {
        prices.set(member.id, priceOfOffer(member.offer, query.atShop));
      }
    }

    const rest = itemIds.filter((itemId) => !prices.has(itemId));
    const wanted = new Set(query.priceScopeIds);
    const reads = await Promise.all(
      rest.map((itemId) => this._browse.scopeOffers(itemId))
    );
    for (const [index, rows] of reads.entries()) {
      if (rows === null) {
        return null;
      }
      const best =
        rows
          .filter(
            (row) =>
              row.available &&
              (wanted.size === 0 || wanted.has(row.offer.priceScopeId))
          )
          .map((row) => row.offer)
          .sort(compareGroupOffers)[0] ?? null;
      prices.set(rest[index], priceOfOffer(best, query.atShop));
    }

    return { members, prices };
  }
}

function priceOfOffer(
  offer: ProductOffer | null,
  atShop: boolean
): ProductChoicePrice {
  if (offer === null) {
    return atShop ? NOT_SOLD : NO_PRICE;
  }
  return { kind: 'priced', offer };
}

function sameQuery(a: ChangeChoicesQuery, b: ChangeChoicesQuery): boolean {
  return (
    a.atShop === b.atShop &&
    a.itemIds.join(',') === b.itemIds.join(',') &&
    a.priceScopeIds.join(',') === b.priceScopeIds.join(',')
  );
}
