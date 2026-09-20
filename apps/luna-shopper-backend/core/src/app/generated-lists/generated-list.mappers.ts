import type {
  BasketSourceView,
  GeneratedListSummaryView,
  GeneratedListView,
} from '@portfolio/luna-shopper/contracts';
import type {
  BasketSource,
  GeneratedList,
} from '../entities';

/**
 * Rows to wire views (plan 0050).
 *
 * The children are passed in rather than read from a relation, on the same
 * reasoning `profile.mappers.ts` gives: the parent declares no `OneToMany`, so
 * there is no lazy relation to be loaded once per row by accident, and the
 * service reads every line's origins and options in one query each whatever the
 * size of the basket.
 */

/**
 * One source row as the wire describes it (plan 0133, section 4).
 *
 * A row is what the run was **asked for**, so a null `listId` travels as null and
 * means the whole zone. The client reads it that way and draws nothing different
 * for it in this plan.
 */
export function toBasketSourceView(row: BasketSource): BasketSourceView {
  return { zoneId: row.zoneId, listId: row.listId };
}

/**
 * What this basket has bought for each of a line's origins, keyed on the **zone
 * line** a settlement landed on, which is what `generated_list_line_origins`
 * is unique on beside the basket line.
 */
/**
 * The basket's header and the sources it was composed from (plan 0136).
 *
 * It carries **no lines**, because a basket stores none: its rows are read from
 * `list_lines` on every request by `BasketReadService`, and this is the owner's
 * view of the trip itself rather than of what is in it.
 */
export function toGeneratedListView(
  row: GeneratedList,
  sources: BasketSourceView[] = []
): GeneratedListView {
  return {
    id: row.id,
    kind: row.kind,
    // Null travels as null. The client renders the generation date; core has no
    // locale to render it in (plan 0050, section 1).
    name: row.name,
    status: row.status,
    generatedAt: row.generatedAt.toISOString(),
    // What the run was asked to draw from (plan 0133, section 4). Empty on a
    // `LIVE` basket, whose coverage is a rule rather than a list of sources.
    sources,
  };
}

/**
 * A basket without its lines, for the history listing (section 7).
 *
 * The counts are passed in rather than derived from loaded lines, because the
 * listing deliberately does not load them: a page of trips that read every line
 * of every trip to render a date and a number is the read that would eventually
 * need fixing.
 *
 * `presentCount` is passed in separately from the rest and defaults to zero,
 * because it is the one number here that does not come from the database (plan
 * 0053, section 2). It is resolved from the presence store at read time by
 * whoever can reach it, and core cannot: a basket nobody is in, a presence store
 * that is down and a caller that did not ask all answer nobody, which is what
 * presence failing open and empty means everywhere else in this system.
 */
export function toGeneratedListSummaryView(
  row: GeneratedList,
  counts: GeneratedListLineCounts,
  presentCount = 0
): GeneratedListSummaryView {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    status: row.status,
    generatedAt: row.generatedAt.toISOString(),
    lineCount: counts.lineCount,
    settledLineCount: counts.settledLineCount,
    boughtLineCount: counts.boughtLineCount,
    notAvailableLineCount: counts.notAvailableLineCount,
    presentCount,
  };
}

/** What a history row counts, before it is a view. */
export interface GeneratedListLineCounts {
  lineCount: number;
  settledLineCount: number;
  boughtLineCount: number;
  notAvailableLineCount: number;
}

/** A basket whose lines have not been read at all, or which has none. */
export const NO_GENERATED_LINE_COUNTS: GeneratedListLineCounts = {
  lineCount: 0,
  settledLineCount: 0,
  boughtLineCount: 0,
  notAvailableLineCount: 0,
};
