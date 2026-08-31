import type {
  GeneratedListLineOriginView,
  GeneratedListLineView,
  GeneratedListSummaryView,
  GeneratedListView,
} from '@portfolio/luna-shopper/contracts';
import type {
  GeneratedList,
  GeneratedListLine,
  GeneratedListLineOption,
  GeneratedListLineOrigin,
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

export function toOriginView(
  row: GeneratedListLineOrigin
): GeneratedListLineOriginView {
  return {
    id: row.id,
    zoneId: row.zoneId,
    listId: row.listId,
    lineId: row.lineId,
    quantity: row.quantity,
    lineVersion: row.lineVersion,
  };
}

export function toGeneratedLineView(
  row: GeneratedListLine,
  children: {
    origins: GeneratedListLineOrigin[];
    options: GeneratedListLineOption[];
  }
): GeneratedListLineView {
  return {
    id: row.id,
    content: row.content,
    quantity: row.quantity,
    settledQuantity: row.settledQuantity,
    itemId: row.itemId,
    options: children.options.map((option) => option.itemId),
    origin: row.origin,
    targetListId: row.targetListId,
    position: row.position,
    origins: children.origins.map(toOriginView),
  };
}

export function toGeneratedListView(
  row: GeneratedList,
  lines: GeneratedListLineView[]
): GeneratedListView {
  return {
    id: row.id,
    // Null travels as null. The client renders the generation date; core has no
    // locale to render it in (plan 0050, section 1).
    name: row.name,
    status: row.status,
    generatedAt: row.generatedAt.toISOString(),
    sourceSnapshot: row.sourceSnapshot,
    lines,
  };
}

/**
 * A basket without its lines, for the history listing (section 7).
 *
 * The two counts are passed in rather than derived from loaded lines, because the
 * listing deliberately does not load them: a page of trips that read every line
 * of every trip to render a date and a number is the read that would eventually
 * need fixing.
 */
export function toGeneratedListSummaryView(
  row: GeneratedList,
  counts: { lineCount: number; settledLineCount: number }
): GeneratedListSummaryView {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    generatedAt: row.generatedAt.toISOString(),
    lineCount: counts.lineCount,
    settledLineCount: counts.settledLineCount,
  };
}
