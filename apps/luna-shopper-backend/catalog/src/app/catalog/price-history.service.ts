import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  PRICE_HISTORY_LIMITS,
  type ItemPriceHistoryRequest,
  type ItemPriceHistoryView,
  type ItemPriceSeriesView,
} from '@portfolio/luna-shopper/contracts';
import {
  isUuid,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { In, Repository } from 'typeorm';
import { Item, ItemPrice, PricePolicy, PriceScope } from '../entities';
import { type PolicyRow } from './effective-price';
import { lessSpecificScopesOf } from './effective-price.service';
import { priceHistory, type HistoryPriceRow } from './price-history';
import { unitBasisOf } from './unit-basis';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The price history a shopper can read (plan 0196, section 2).
 *
 * A read and nothing else: it loads rows of `item_prices`, hands them to the
 * pure {@link priceHistory}, and writes nothing (plan 0080). The admin read
 * `itemPrice.list` answers every row that a source stated. This one answers
 * the price that the rule showed, which on most days is one of those rows and
 * on some days is none.
 *
 * Open to any account, as reading a product is. The scopes come resolved
 * from the gateway, and this service invents none.
 */
@Injectable()
export class PriceHistoryService {
  constructor(
    @InjectRepository(ItemPrice)
    private readonly prices: Repository<ItemPrice>,
    @InjectRepository(Item) private readonly items: Repository<Item>,
    @InjectRepository(PriceScope)
    private readonly scopes: Repository<PriceScope>,
    @InjectRepository(PricePolicy)
    private readonly policies: Repository<PricePolicy>
  ) {}

  /**
   * One series for each scope asked that exists, in the order asked.
   *
   * @param now the instant an absent `to` means. A spec passes its own.
   */
  async forItem(
    req: ItemPriceHistoryRequest,
    now: Date = new Date()
  ): Promise<ItemPriceHistoryView> {
    const { from, to } = rangeOf(req, now);
    // The 404 that reading the product answers, in the same words. An id
    // that is not a uuid names no product, and is not handed to the query.
    const known = isUuid(req.itemId ?? '')
      ? await this.items.exists({ where: { id: req.itemId } })
      : false;
    if (!known) {
      throw new NotFoundException('Item not found');
    }

    // The scopes in the order asked, each one time. An id that names no
    // scope gives no series, and so does an id that is not a uuid.
    const askedIds = [...new Set(req.priceScopeIds ?? [])]
      .filter((id) => isUuid(id))
      .slice(0, PRICE_HISTORY_LIMITS.maxScopes);
    const found =
      askedIds.length === 0
        ? []
        : await this.scopes.find({ where: { id: In(askedIds) } });
    const byId = new Map(found.map((scope) => [scope.id, scope]));
    const scopes = askedIds
      .map((id) => byId.get(id))
      .filter((scope): scope is PriceScope => scope !== undefined);
    if (scopes.length === 0) {
      return {
        itemId: req.itemId,
        from: from.toISOString(),
        to: to.toISOString(),
        series: [],
      };
    }

    // The stack of each scope, as `recomputeEffectivePrices` builds it: the
    // scope, the scopes it falls through to, and one priority for each. One
    // after the other and not at once, so a read of fifty scopes holds one
    // connection of the pool and not fifty.
    const stacks: {
      scope: PriceScope;
      scopePriorities: Map<string, number>;
    }[] = [];
    const loadedIds = new Set<string>();
    for (const scope of scopes) {
      const inherited = await lessSpecificScopesOf(this.scopes.manager, scope);
      const scopePriorities = new Map<string, number>([
        [scope.id, scope.priority],
        ...inherited.map((row): [string, number] => [row.id, row.priority]),
      ]);
      for (const id of scopePriorities.keys()) {
        loadedIds.add(id);
      }
      stacks.push({ scope, scopePriorities });
    }

    // The policies as they are now. The replay says in its own comment that
    // it cannot know what they were on the day.
    const policies: PolicyRow[] = await this.policies.find();
    const rows = await this.rowsUntil(req.itemId, [...loadedIds], to);

    const series: ItemPriceSeriesView[] = stacks.map(
      ({ scope, scopePriorities }) => ({
        priceScopeId: scope.id,
        supermarketId: scope.supermarketId,
        points: priceHistory({
          rows: rows.filter((row) => scopePriorities.has(row.priceScopeId)),
          priceScopeId: scope.id,
          scopePriorities,
          policies,
          from,
          to,
        }).map((point) => ({
          at: point.at.toISOString(),
          price: point.price,
          currency: point.currency,
          unitPrice: point.unitPrice,
          unitPriceLabel: point.unitPriceLabel,
          unitBasis: unitBasisOf(point.unitPriceLabel),
        })),
      })
    );

    return {
      itemId: req.itemId,
      from: from.toISOString(),
      to: to.toISOString(),
      series,
    };
  }

  /**
   * Every row of the product at these scopes that began at or before `to`,
   * for all the stacks of the read in one statement.
   * `ix_item_prices_history` starts with the product and the scope.
   *
   * It has no lower bound on purpose. The row that was current at `from` can
   * be older than any range: a price that a source stated two years ago and
   * repeated each week since is one row that began two years ago.
   */
  private async rowsUntil(
    itemId: string,
    priceScopeIds: string[],
    to: Date
  ): Promise<HistoryPriceRow[]> {
    return this.prices
      .createQueryBuilder('p')
      .select([
        'p.id',
        'p.priceScopeId',
        'p.sourceKind',
        'p.price',
        'p.currency',
        'p.unitPrice',
        'p.unitPriceLabel',
        'p.observedAt',
        'p.lastObservedAt',
        'p.validFrom',
        'p.validUntil',
        'p.overrides',
        'p.protectedUntil',
      ])
      .where('p."itemId" = :itemId', { itemId })
      .andWhere('p."priceScopeId" IN (:...priceScopeIds)', { priceScopeIds })
      .andWhere('p."observedAt" <= :to', { to })
      .orderBy('p."observedAt"', 'ASC')
      .addOrderBy('p."id"', 'ASC')
      .getMany();
  }
}

/**
 * The range a request names, after the defaults and the cut (plan 0196,
 * section 2).
 *
 * `to` defaults to now, and `from` to
 * {@link PRICE_HISTORY_LIMITS.defaultDays} before `to`. A `from` after `to` is
 * refused. A range longer than {@link PRICE_HISTORY_LIMITS.maxDays} is cut at
 * its start and not refused, so a client that asks for "everything" gets the
 * most that one read answers.
 */
export function rangeOf(
  req: Pick<ItemPriceHistoryRequest, 'from' | 'to'>,
  now: Date
): { from: Date; to: Date } {
  const to = req.to === undefined ? now : instantOf(req.to, 'to');
  const stated = req.from === undefined ? null : instantOf(req.from, 'from');
  if (stated !== null && stated.getTime() > to.getTime()) {
    throw new ValidationException('from must not be after to', {
      messageArgs: { field: 'from' },
    });
  }
  const earliest = to.getTime() - PRICE_HISTORY_LIMITS.maxDays * DAY_MS;
  const from =
    stated === null
      ? to.getTime() - PRICE_HISTORY_LIMITS.defaultDays * DAY_MS
      : Math.max(stated.getTime(), earliest);
  return { from: new Date(from), to };
}

/** An ISO instant as a date, or the refusal that names its field. */
function instantOf(value: string, field: 'from' | 'to'): Date {
  const parsed = new Date(value);
  if (typeof value !== 'string' || Number.isNaN(parsed.getTime())) {
    throw new ValidationException(`${field} must be an ISO 8601 instant`, {
      messageArgs: { field },
    });
  }
  return parsed;
}
