import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ItemSourceMatch,
  productGtin,
  SourceEntryStatus,
  type AddItemPriceBatchResult,
  type ItemPriceValues,
  type ItemView,
  type PriceSourceKind,
  type SourceEntryPriceWithheld,
} from '@portfolio/luna-shopper/contracts';
import { Not, Repository } from 'typeorm';
import { SourceCatalogEntry, SourceEntryPrice } from '../entities';
import { CatalogClient } from './catalog-client.service';
import { toItemPriceDetails } from './harvest.mappers';

/**
 * The two writes deciding a queued row makes, shared by the one at a time
 * routes and the bulk replay of plan 0100.
 *
 * They live here rather than inside `SourceEntryService` because the bulk route
 * has to make the same writes from inside its own transaction, and a second
 * copy of either is a copy that drifts. What "accepting a row" means to the
 * database is stated once, in this file.
 */

/**
 * ACTIVE, bound, and MANUAL: a person decided, so the confidence is 1.
 *
 * Mutates and returns the row rather than saving it, because the caller decides
 * whether the save goes through a repository or through the entity manager of a
 * transaction it is holding open.
 *
 * `name`, `brand` and `sizeFormat` are deliberately untouched. The item may be
 * renamed to anything at all and the next run that produces this key still
 * resolves through this row (plan 0086, D8). `ean` is untouched too: the row
 * keeps what the chain printed, an in-store code included (plan 0184).
 *
 * **Always `MANUAL`, also when the product holds the row's own barcode.** Plan
 * 0184 asked for `EAN` in that case, and the owner decided against it on
 * 2026-10-04. `unbindSharedEans` in `source-ingest.ts` unbinds an `ACTIVE` row
 * stamped `EAN` when a second row of the chain prints the same barcode, and it
 * skips `MANUAL` rows, so `MANUAL` is the only thing that keeps a run from
 * reopening a person's decision. The plan file records the alternatives.
 */
export function bindFields(
  entry: SourceCatalogEntry,
  itemId: string,
  now: Date = new Date()
): SourceCatalogEntry {
  entry.itemId = itemId;
  entry.candidateEntryId = null;
  entry.status = SourceEntryStatus.ACTIVE;
  entry.matchedBy = ItemSourceMatch.MANUAL;
  entry.confidence = 1;
  entry.decidedAt = now;
  return entry;
}

/**
 * The EAN a product created from a queue row is given (plan 0184): a real
 * barcode or none.
 *
 * The request's own EAN when it names one, else the row's, as every other
 * field of a create falls back. Whichever it is goes through `readGtin`, and
 * an in-store code (13 digits starting with 2) or an invalid code answers
 * null, so the product is created with no EAN. The row is not changed.
 */
export function createdEan(
  entry: Pick<SourceCatalogEntry, 'ean'>,
  requested: string | null | undefined
): string | null {
  return productGtin(requested === undefined ? entry.ean : requested);
}

/**
 * The barcode a bound row can teach its product (plan 0185): the row's own
 * EAN when it is a real barcode, else null.
 *
 * An in-store code and an invalid code teach nothing, because a product never
 * holds one (plan 0184). The row keeps what the chain printed either way.
 */
export function taughtEan(
  entry: Pick<SourceCatalogEntry, 'ean'>
): string | null {
  return productGtin(entry.ean);
}

/**
 * Every barcode a catalog product holds (plan 0185): `eans`, and `ean` beside
 * it for an answer from a catalog that does not list them yet.
 */
export function barcodesOf(item: Pick<ItemView, 'ean' | 'eans'>): string[] {
  return [...new Set([...(item.eans ?? []), ...(item.ean ? [item.ean] : [])])];
}

/**
 * How many rows each (chain, EAN) of these rows has, in one query.
 *
 * Every row of the chain counts, this one included, whatever its status and
 * whatever its source kind. That is what `ChainEanIndex` counts for the
 * ingest, which loads every row of the chain and nothing narrower.
 */
export async function chainEanCounts(
  entries: Repository<SourceCatalogEntry>,
  rows: readonly Pick<SourceCatalogEntry, 'supermarketId' | 'ean'>[]
): Promise<Map<string, number>> {
  const eans = [
    ...new Set(
      rows.map((row) => row.ean).filter((ean): ean is string => !!ean)
    ),
  ];
  const counts = new Map<string, number>();
  if (eans.length === 0) {
    return counts;
  }
  const found: { supermarketId: string; ean: string; count: number }[] =
    await entries.query(
      `
      SELECT e."supermarketId"::text AS "supermarketId",
             e."ean"                 AS "ean",
             count(*)::int           AS "count"
        FROM "source_catalog_entries" e
       WHERE e."ean" = ANY($1::varchar[])
       GROUP BY e."supermarketId", e."ean"
      `,
      [eans]
    );
  for (const row of found) {
    counts.set(chainEanKey(row), row.count);
  }
  return counts;
}

/** The key {@link chainEanCounts} answers under. */
export function chainEanKey(
  row: Pick<SourceCatalogEntry, 'supermarketId' | 'ean'>
): string {
  return `${row.supermarketId}|${row.ean}`;
}

/**
 * Whether more than one row of the row's own chain prints its EAN (plan 0185).
 *
 * **The ingest's own notion of shared, and no second one**: `ChainEanIndex`
 * calls an EAN shared when more than one row of the chain carries it (plan
 * 0155). Mercadona gives one EAN to five cuts of one fish, and each cut is a
 * product of its own. Such a barcode names no single product, so a row that
 * prints it neither teaches it nor is refused because another product holds
 * it: the accept binds the row and writes its prices, as it did before the
 * plan. The owner can change this rule.
 */
export function sharesEanInChain(
  entry: Pick<SourceCatalogEntry, 'supermarketId' | 'ean'>,
  counts: ReadonlyMap<string, number>
): boolean {
  return (counts.get(chainEanKey(entry)) ?? 0) > 1;
}

/** The sentence a decision is refused with when another product holds the row's barcode. */
export function eanHeldDetail(
  ean: string,
  heldBy: string,
  itemId: string | null
): string {
  return (
    `The row prints the barcode ${ean}, and the catalog holds it on product ` +
    `${heldBy}${itemId ? `, not on ${itemId}` : ''}. A barcode names one ` +
    'product: accept the row onto that product, or take the barcode off it ' +
    'first.'
  );
}

/**
 * The sentence a move is refused with when the barcode has to stay on the
 * product the row leaves (plan 0191).
 *
 * A barcode moves with its row only when the row was the one thing that put
 * it there. Here another bound row prints it on the old product too, so the
 * barcode is that product's on the word of a row that is staying.
 */
export function eanStaysDetail(
  ean: string,
  oldItemId: string,
  itemId: string | null,
  otherEntryIds: readonly string[]
): string {
  return (
    `The row prints the barcode ${ean}, and the catalog holds it on product ` +
    `${oldItemId}, the product the row is bound to now` +
    `${itemId ? `, not on ${itemId}` : ''}. The barcode does not move with ` +
    `the row, because another row bound to ${oldItemId} prints it too ` +
    `(${otherEntryIds.join(', ')}). A barcode names one product: move that ` +
    'row as well, or take the barcode off the product first.'
  );
}

/**
 * **One rule for two articles of one chain on one product** (plans 0155, 0181
 * and 0191), stated here and used by a run and by a decision alike.
 *
 * Catalog keeps one current price per product, scope and source kind. A chain
 * can list one product more than once, and each of those rows states a price.
 * So for the rows of one chain and one source kind that are bound to one
 * product and hold a price at one scope, this says which price is sent:
 *
 * 1. **One row: its price.**
 * 2. **Every row is sold by weight: the lowest price per kilo** (plan 0181).
 *    Two pieces of one cheese are one product sold by the kilo, each figure
 *    is the price of a kilo, and {@link lowestPerKilo} picks the least a
 *    shopper pays for one.
 * 3. **The rows agree on the amount: that amount.** Two barcodes of one
 *    product at one price are not a question, and withholding it would leave
 *    a product unpriced that every row prices the same.
 * 4. **Otherwise none is sent** (plan 0155, and the owner's decision 2A of
 *    plan 0191). The rows are packs of two sizes, or two products bound to
 *    one. No rule picks one pack's price for another, so the price that was
 *    current before stays and ages, and a person makes a second product or
 *    removes a row.
 *
 * It decides and writes nothing. A run compares what it stated across every
 * chunk it pushed, and a decision compares the row with the rows already
 * bound, and both read the answer here.
 */
export interface Article {
  /** The source row that states the price. */
  entryId: string;
  /** The row's own flag (plan 0181): its price is the price of a kilo. */
  soldByWeight: boolean;
  price: number | string | null;
  unitPrice: number | string | null;
}

/** What {@link decideArticles} says about the rows that price one product at one scope. */
export type ArticleVerdict<T> =
  /** One price is sent, and it is this row's. */
  | { send: T; conflict: null }
  /** No price is sent. These rows state different amounts. */
  | { send: null; conflict: T[] };

/** Rule {@link Article}: the one price these rows send, or the rows that disagree. */
export function decideArticles<T extends Article>(
  articles: readonly T[]
): ArticleVerdict<T> | null {
  const [first] = articles;
  if (!first) {
    return null;
  }
  if (articles.length === 1) {
    return { send: first, conflict: null };
  }
  if (articles.every((each) => each.soldByWeight)) {
    return {
      send: lowestPerKilo<T>(articles, perKiloOfArticle) ?? first,
      conflict: null,
    };
  }
  if (articles.every((each) => sameAmount(each, first))) {
    return { send: first, conflict: null };
  }
  return { send: null, conflict: [...articles] };
}

/** Whether two rows state the same amount: the price and the unit price. */
export function sameAmount(a: Article, b: Article): boolean {
  return (
    amountOf(a.price) === amountOf(b.price) &&
    amountOf(a.unitPrice) === amountOf(b.unitPrice)
  );
}

/** A `numeric` arrives from Postgres as text, and `"2.50"` is `2.5`. */
function amountOf(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

function perKiloOfArticle(article: Article): number | null {
  return amountOf(article.unitPrice ?? article.price);
}

/** A stored price beside the row that states it, as {@link decideArticles} reads it. */
export interface StatedPrice extends Article {
  entry: SourceCatalogEntry;
  stated: SourceEntryPrice;
}

function statedPrice(
  entry: SourceCatalogEntry,
  stated: SourceEntryPrice
): StatedPrice {
  return {
    entryId: entry.id,
    soldByWeight: entry.soldByWeight === true,
    price: stated.price,
    unitPrice: stated.unitPrice,
    entry,
    stated,
  };
}

/** How {@link statementsOf} reads the rows it is handed. */
export interface StatementOptions {
  /**
   * The run pieces sold by weight are compared within, for a scope and kind.
   * For a decision it is the run of the row being decided. Absent, it is the
   * run of the newest statement.
   */
  runOf?: (priceScopeId: string, sourceKind: PriceSourceKind) => string | null;
  /**
   * The kind a price is stated under. Absent, it is the kind the row says
   * now, which is what an accept writes with until plan 0190 puts the kind on
   * the price row. The settle passes the kind of the run that observed the
   * price. A null leaves the price out: nothing is stated under a kind that
   * is not known.
   */
  kindOf?: (
    entry: SourceCatalogEntry,
    price: SourceEntryPrice
  ) => PriceSourceKind | null;
}

/**
 * What the bound rows of one chain state for one product, per scope and
 * source kind, and what {@link decideArticles} makes of each (plan 0191).
 *
 * The rows are the ones bound to the product now. For each scope and kind at
 * which any of them holds an open price, the answer is the one price to send
 * or the rows that disagree.
 *
 * **Pieces sold by weight are compared within one run** (plan 0181): a row
 * the chain stopped listing keeps its last price, and that number is not
 * allowed to win against what the chain says today.
 *
 * **Rows that agree send the newest observation.** "The first" of rule 3 is
 * the row whose price was observed last, so a row the chain stopped listing,
 * which holds an old price of the same amount, does not put its old instant
 * and its old run on the price a newer row states.
 */
export function statementsOf(
  bound: readonly SourceCatalogEntry[],
  now: Date,
  options: StatementOptions = {}
): {
  priceScopeId: string;
  sourceKind: PriceSourceKind;
  verdict: ArticleVerdict<StatedPrice>;
}[] {
  const { runOf, kindOf } = options;
  const groups = new Map<
    string,
    {
      priceScopeId: string;
      sourceKind: PriceSourceKind;
      articles: StatedPrice[];
    }
  >();
  for (const entry of bound) {
    for (const stated of openPrices(entry, now)) {
      const sourceKind = kindOf ? kindOf(entry, stated) : entry.sourceKind;
      if (sourceKind === null) {
        continue;
      }
      const key = `${stated.priceScopeId}|${sourceKind}`;
      const group = groups.get(key) ?? {
        priceScopeId: stated.priceScopeId,
        sourceKind,
        articles: [],
      };
      group.articles.push(statedPrice(entry, stated));
      groups.set(key, group);
    }
  }

  const statements = [];
  for (const group of groups.values()) {
    // Newest observation first, then oldest decision, then id: the same
    // order whoever asks and in whatever order the rows were loaded.
    let articles = [...group.articles].sort(
      (a, b) =>
        b.stated.observedAt.getTime() - a.stated.observedAt.getTime() ||
        (a.entry.decidedAt?.getTime() ?? 0) -
          (b.entry.decidedAt?.getTime() ?? 0) ||
        a.entryId.localeCompare(b.entryId)
    );
    if (articles.length > 1 && articles.every((each) => each.soldByWeight)) {
      const runId = runOf
        ? runOf(group.priceScopeId, group.sourceKind)
        : newestOf(articles).stated.runId;
      const sameRun = articles.filter((each) => each.stated.runId === runId);
      articles = sameRun.length > 0 ? sameRun : articles;
    }
    const verdict = decideArticles(articles);
    if (verdict) {
      statements.push({
        priceScopeId: group.priceScopeId,
        sourceKind: group.sourceKind,
        verdict,
      });
    }
  }
  return statements;
}

/** The values of a stored price, as catalog takes them (plans 0086 and 0191). */
export function priceValuesOf(
  price: SourceEntryPrice
): ItemPriceValues & { observedAt: string } {
  return {
    price: price.price === null ? null : Number(price.price),
    currency: price.currency,
    unitPrice: price.unitPrice === null ? null : Number(price.unitPrice),
    unitPriceLabel: price.unitPriceLabel,
    validFrom: price.validFrom?.toISOString() ?? null,
    validUntil: price.validUntil?.toISOString() ?? null,
    observedAt: price.observedAt.toISOString(),
    details: toItemPriceDetails(price.details ?? null),
  };
}

function newestOf(articles: readonly StatedPrice[]): StatedPrice {
  return articles.reduce((newest, each) =>
    each.stated.observedAt.getTime() > newest.stated.observedAt.getTime()
      ? each
      : newest
  );
}

/** What writing the prices of one bound row came to (plan 0191). */
export interface PriceWriteOutcome {
  /** `item_prices` rows catalog inserted. A price it already held counts nothing. */
  written: number;
  /** The scopes whose price was not sent, and the rows it met there. */
  withheld: SourceEntryPriceWithheld[];
}

/**
 * **One price per product, scope and source (plan 0181).**
 *
 * Catalog keeps one current price per product, scope and source kind. A chain
 * lists a product sold by weight once per piece: a cheese of about 1.5 kg and
 * the same cheese of about 0.4 kg are two rows, and by the owner's rule they
 * are one product, sold by the kilo. Each row states the price of a kilo, and
 * the two can differ (9.41 against 9.70 for one cheese).
 *
 * So when several rows of one chain and one source kind are bound to one
 * product and every one of them is sold by weight, the price written for a
 * scope is **the lowest price per kilo among them**. It is the least a
 * shopper pays for a kilo of that product at that scope.
 *
 * Three things the rule does not do:
 *
 * - It does not reach rows that are not sold by weight. Their prices are for
 *   packs of different sizes, the lowest one says nothing about the others,
 *   and plan 0155 still refuses to send any of them.
 * - It never computes a figure. Every candidate is a price the chain stated,
 *   and the one written is one of them, unchanged.
 * - It compares what one run stated. A row the chain stopped listing keeps its
 *   last price row, and that number is not allowed to win against what the
 *   chain says today.
 *
 * This is the owner's call to change. The other honest answers are the
 * highest, the price of the largest piece, and no price until a person picks.
 *
 * Answers the candidate with the lowest figure, the first of them on a tie. A
 * candidate with no figure loses to any candidate that has one. Null only for
 * an empty list.
 */
export function lowestPerKilo<T>(
  candidates: readonly T[],
  perKilo: (candidate: T) => number | null
): T | null {
  let lowest: T | null = null;
  let lowestFigure: number | null = null;
  for (const candidate of candidates) {
    const figure = perKilo(candidate);
    if (
      lowest === null ||
      (figure !== null && (lowestFigure === null || figure < lowestFigure))
    ) {
      lowest = candidate;
      lowestFigure = figure;
    }
  }
  return lowest;
}

/**
 * Write the prices a decided row holds (plan 0086, section 7).
 *
 * One `catalog.addPrices` call per scope, each with **that scope's own run id**
 * and the row's own `sourceKind`, so plan 0082 can take them back with the rest
 * of that run's rows. An admin who accepts a Mercadona product on Tuesday gets
 * the price Monday's walk saw, stamped with Monday's run.
 *
 * A row whose window has closed writes nothing: an expired price is not one
 * anybody is charged, and inserting one only to have the resolver filter it out
 * is work with a wrong row at the end of it. A row with no price at all writes
 * nothing and says zero, which for a DEZA row is the truth rather than a
 * failure. What such a row is owed instead is an offer with no price and its
 * stored availability, and `SourceEntryAvailabilityWriter` writes both in the
 * same step (plan 0182).
 *
 * **The product may already be bound to another row of the same chain**, and
 * catalog holds one price for the two. So for each scope the row's own price
 * is put beside what the other bound rows of its chain and kind hold there,
 * and {@link decideArticles} says what is sent:
 *
 * - Pieces sold by weight send the lowest price per kilo among those the same
 *   run stated (plan 0181). Accepting a dearer piece therefore confirms the
 *   price catalog already shows, and accepting a cheaper one replaces it.
 * - Another article of another amount sends nothing for that scope (plan
 *   0191, decision 2A). The row is bound all the same, and the answer names
 *   the row it met. Before the plan the second article was written over the
 *   first, and which one a shopper saw depended on who was accepted last.
 */
@Injectable()
export class SourceEntryPriceWriter {
  constructor(
    private readonly catalog: CatalogClient,
    @InjectRepository(SourceCatalogEntry)
    private readonly entries: Repository<SourceCatalogEntry>
  ) {}

  /** {@link writeNamed}, for a caller that reads the count alone. */
  async write(entry: SourceCatalogEntry): Promise<number> {
    return (await this.writeNamed(entry)).written;
  }

  /** Write the open prices of one bound row, and name the ones withheld. */
  async writeNamed(entry: SourceCatalogEntry): Promise<PriceWriteOutcome> {
    const outcome: PriceWriteOutcome = { written: 0, withheld: [] };
    if (!entry.itemId) {
      return outcome;
    }
    const now = new Date();
    const own = openPrices(entry, now);
    if (own.length === 0) {
      return outcome;
    }
    const ownRun = new Map(
      own.map((stated) => [stated.priceScopeId, stated.runId])
    );
    const priced = new Set(own.map((stated) => stated.priceScopeId));
    const statements = statementsOf(
      [entry, ...(await this.othersBound(entry))],
      now,
      { runOf: (priceScopeId) => ownRun.get(priceScopeId) ?? null }
    );

    for (const { priceScopeId, sourceKind, verdict } of statements) {
      // Only the scopes this row prices. What the other rows state elsewhere
      // was written when they were bound.
      if (!priced.has(priceScopeId) || sourceKind !== entry.sourceKind) {
        continue;
      }
      if (verdict.send === null) {
        outcome.withheld.push({
          entryId: entry.id,
          priceScopeId,
          otherEntryIds: verdict.conflict
            .map((each) => each.entryId)
            .filter((id) => id !== entry.id),
        });
        continue;
      }
      // Pieces sold by weight send the lowest of them, which can be another
      // piece's. Every other verdict that sends is one amount, and the row
      // being written states it: its own statement is the one that goes.
      const mine = own.find((stated) => stated.priceScopeId === priceScopeId);
      const chosen =
        verdict.send.soldByWeight || !mine ? verdict.send.stated : mine;
      const result = await this.send(entry.itemId, entry.sourceKind, chosen);
      outcome.written += result.inserted;
    }
    return outcome;
  }

  /**
   * The one `catalog.addPrices` call of a stored price, for a product.
   *
   * With **that price's own run id**, its own `observedAt` and the source
   * kind of the row that states it, so plan 0082 can take it back with the
   * rest of that run's rows.
   */
  send(
    itemId: string,
    sourceKind: PriceSourceKind,
    price: SourceEntryPrice
  ): Promise<AddItemPriceBatchResult> {
    return this.catalog.addPrices(
      price.priceScopeId,
      [{ itemId, ...priceValuesOf(price) }],
      price.runId,
      sourceKind,
      // A copied row keeps its provenance when a person accepts it later
      // (plan 0118): the price was still read at the other scope.
      price.copiedFromScopeId ?? null
    );
  }

  /**
   * The other rows of this chain and source kind that are bound to the same
   * product, with their prices.
   */
  private async othersBound(
    entry: SourceCatalogEntry
  ): Promise<SourceCatalogEntry[]> {
    if (!entry.itemId) {
      return [];
    }
    return this.entries.find({
      where: {
        id: Not(entry.id),
        supermarketId: entry.supermarketId,
        sourceKind: entry.sourceKind,
        itemId: entry.itemId,
        status: SourceEntryStatus.ACTIVE,
      },
      relations: { prices: true },
    });
  }
}

/**
 * The prices of a row whose window has not closed.
 *
 * Exported for the availability half of a bind (plan 0182): a row with none of
 * these is the row that is owed an offer with no price.
 */
export function openPrices(
  entry: SourceCatalogEntry,
  now: Date
): SourceEntryPrice[] {
  return (entry.prices ?? []).filter(
    (price) => price.validUntil === null || price.validUntil > now
  );
}
