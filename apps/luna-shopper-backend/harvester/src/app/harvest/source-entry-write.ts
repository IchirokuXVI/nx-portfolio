import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ItemSourceMatch,
  productGtin,
  SourceEntryStatus,
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
 * **A row sold by weight writes the lowest price per kilo of its product**
 * (plan 0181, and {@link lowestPerKilo}). The product may already be bound to
 * another piece of the same chain, and catalog holds one price for the two. So
 * for each scope the row's own price is compared with what the other pieces
 * hold from the same run, and the lowest of them is the one written. Accepting
 * a dearer piece therefore confirms the price catalog already shows, and
 * accepting a cheaper one replaces it.
 */
@Injectable()
export class SourceEntryPriceWriter {
  constructor(
    private readonly catalog: CatalogClient,
    @InjectRepository(SourceCatalogEntry)
    private readonly entries: Repository<SourceCatalogEntry>
  ) {}

  async write(entry: SourceCatalogEntry): Promise<number> {
    if (!entry.itemId) {
      return 0;
    }
    const now = new Date();
    const own = openPrices(entry, now);
    const others =
      own.length > 0
        ? (await this.otherPieces(entry)).flatMap((piece) =>
            openPrices(piece, now)
          )
        : [];
    let written = 0;

    for (const stated of own) {
      const price =
        lowestPerKilo(
          [
            stated,
            ...others.filter(
              (other) =>
                other.priceScopeId === stated.priceScopeId &&
                other.runId === stated.runId
            ),
          ],
          perKiloOf
        ) ?? stated;
      const result = await this.catalog.addPrices(
        price.priceScopeId,
        [
          {
            itemId: entry.itemId,
            price: price.price === null ? null : Number(price.price),
            currency: price.currency,
            unitPrice:
              price.unitPrice === null ? null : Number(price.unitPrice),
            unitPriceLabel: price.unitPriceLabel,
            validFrom: price.validFrom?.toISOString() ?? null,
            validUntil: price.validUntil?.toISOString() ?? null,
            observedAt: price.observedAt.toISOString(),
            details: toItemPriceDetails(price.details ?? null),
          },
        ],
        price.runId,
        entry.sourceKind,
        // A copied row keeps its provenance when a person accepts it later
        // (plan 0118): the price was still read at the other scope.
        price.copiedFromScopeId ?? null
      );
      written += result.inserted;
    }
    return written;
  }

  /**
   * The other rows of this chain and source kind that are bound to the same
   * product and sold by weight, with their prices. None for a row that is not
   * sold by weight itself.
   */
  private async otherPieces(
    entry: SourceCatalogEntry
  ): Promise<SourceCatalogEntry[]> {
    if (entry.soldByWeight !== true || !entry.itemId) {
      return [];
    }
    return this.entries.find({
      where: {
        id: Not(entry.id),
        supermarketId: entry.supermarketId,
        sourceKind: entry.sourceKind,
        itemId: entry.itemId,
        status: SourceEntryStatus.ACTIVE,
        soldByWeight: true,
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

/** The price of a kilo a stored price row states, as a number. */
function perKiloOf(price: SourceEntryPrice): number | null {
  const figure = price.unitPrice ?? price.price;
  return figure === null ? null : Number(figure);
}
