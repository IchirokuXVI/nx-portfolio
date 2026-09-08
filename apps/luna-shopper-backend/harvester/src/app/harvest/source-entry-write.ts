import { Injectable } from '@nestjs/common';
import {
  ItemSourceMatch,
  SourceEntryStatus,
} from '@portfolio/luna-shopper/contracts';
import { SourceCatalogEntry } from '../entities';
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
 * resolves through this row (plan 0086, D8).
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
 * failure.
 */
@Injectable()
export class SourceEntryPriceWriter {
  constructor(private readonly catalog: CatalogClient) {}

  async write(entry: SourceCatalogEntry): Promise<number> {
    if (!entry.itemId) {
      return 0;
    }
    const now = new Date();
    const open = (entry.prices ?? []).filter(
      (price) => price.validUntil === null || price.validUntil > now
    );
    let written = 0;

    for (const price of open) {
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
        entry.sourceKind
      );
      written += result.inserted;
    }
    return written;
  }
}
