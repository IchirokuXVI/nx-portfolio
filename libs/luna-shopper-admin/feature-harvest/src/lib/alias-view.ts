import {
  formatCurrencyAmount,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { formatInstant } from './format-instant';

/** One row of `source_aliases`, as the gateway sends it. */
export type SourceAlias = Wire.HarvestSourceAliasView;

/**
 * One queued printed name, as the queue draws it (admin plan 0010, section 3).
 *
 * A view model rather than the wire row, for the reason `shop-view.ts` gives
 * next door: plan 0004 section 2's exception is about **shapes**, not about
 * formatting, and a date is formatted with `Intl` in the selector with the
 * string on the view model. Three more things here are decisions rather than
 * columns: which of the three actions a row offers, whether there is a
 * candidate to preselect, and what the offer's price reads as.
 *
 * It lives here rather than in `models`, which is where plan 0010 section 6
 * puts it, because `formatInstant` lives here and a second copy of it in
 * `models` would be the one nothing exercises. `ShopRow` was placed the same
 * way by the plan immediately before this one.
 */
export interface SourceAliasRow {
  readonly id: string;
  /**
   * What the leaflet printed, which no decision ever changes.
   *
   * The owner's rule and the reason the table exists: accepting sets `itemId`
   * and never touches this, so renaming the product does not stop the next
   * leaflet resolving.
   */
  readonly printedName: string;
  readonly printedFormat: string;
  readonly printedBrand: string;
  readonly status: Wire.EnumsSourceAliasStatus;
  /** The product the fuzzy rung proposed, or `''`. Preselected when there is one. */
  readonly candidateItemId: string;
  /** A discovery entry the fuzzy rung proposed instead, or `''`. */
  readonly candidateEntryId: string;
  /** How sure the fuzzy rung was, 0 to 100. */
  readonly confidence: number;
  /** How many leaflets have printed this string. */
  readonly timesSeen: number;

  /** The leaflet's own price for this offer, with its currency. `''` when none. */
  readonly price: string;
  /** The comparison line, with the label the leaflet printed. `''` when none. */
  readonly unitPrice: string;
  /** The page it was printed on, or `''`. */
  readonly page: string;
  /** Every text fragment the extractor assigned to the tile. */
  readonly rawText: readonly string[];
  /** How sure the extractor was about the tile, 0 to 100, or `null`. */
  readonly offerConfidence: number | null;
  readonly lastSeen: string;
  /** The run that queued it, for a link. `''` when the row predates one. */
  readonly lastRunId: string;
}

/**
 * A queued alias, with its numbers already read.
 *
 * The offer columns come off the alias rather than out of the run's document.
 * The harvester copies them onto the row when it queues it (backend plan 0081),
 * so the queue shows what a row was queued for without re-reading a 300 KB
 * document once per row.
 *
 * The unit price keeps the label the leaflet printed, verbatim and never
 * converted. That is the rule the storefront prices already follow: `per l` and
 * `per 100ml` are the chain's own comparison basis, and a screen that
 * normalized them would be quietly disagreeing with the shelf.
 */
export function toSourceAliasRow(
  alias: SourceAlias,
  locale?: string
): SourceAliasRow {
  const unitPrice = formatCurrencyAmount(
    alias.offerUnitPrice,
    alias.offerCurrency,
    locale
  );
  const label = alias.offerUnitPriceLabel ?? '';

  return {
    id: alias.id,
    printedName: alias.printedName,
    printedFormat: alias.printedFormat ?? '',
    printedBrand: alias.printedBrand ?? '',
    status: alias.status,
    candidateItemId: alias.candidateItemId ?? '',
    candidateEntryId: alias.candidateEntryId ?? '',
    confidence: percent(alias.confidence),
    timesSeen: alias.timesSeen,
    price: formatCurrencyAmount(alias.offerPrice, alias.offerCurrency, locale),
    unitPrice:
      unitPrice === '' || label === '' ? unitPrice : `${unitPrice} / ${label}`,
    page: alias.offerPage === null ? '' : String(alias.offerPage),
    rawText: alias.offerRawText,
    offerConfidence:
      alias.offerConfidence === null ? null : percent(alias.offerConfidence),
    lastSeen: formatInstant(alias.lastSeenAt, locale),
    lastRunId: alias.lastRunId ?? '',
  };
}

/**
 * What a new product's Spanish name starts as.
 *
 * The printed name, exactly, and the operator changes it freely. `name.en`
 * stays empty and stays legal, which is what backend plan 0079 bought: before
 * it, saving a leaflet product meant copying the Spanish string into English,
 * where it claimed to be a translation. Now the item lists with a `missing en`
 * tag and a shopper reading English gets the Spanish name through the fallback
 * either way.
 */
export function draftItemName(row: SourceAliasRow): { es: string } {
  return { es: row.printedName };
}

/** A 0 to 1 confidence as whole percent. */
function percent(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100);
}
