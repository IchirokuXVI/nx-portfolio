import type {
  SettlementOutcome,
  GeneratedListBasketLineView,
  GeneratedListBasketView,
  GeneratedListLineOriginView,
  GeneratedListLineView,
  GeneratedListParticipantView,
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

/**
 * One line as a **participant** reads it (plan 0051, section 5).
 *
 * `seesZoneData` decides by **omission**, not by nulling: `origins`,
 * `targetListId` and `origin` all name a zone or a list, so for a reader who does
 * not pass section 5.2 they are absent from the object entirely. That is what
 * makes the redaction hold even if a template somewhere forgets to hide a field,
 * and it is why this is a separate mapper rather than a flag on
 * {@link toGeneratedLineView}.
 *
 * The attribution is always present, for everybody. "Who got the bread" is the
 * question in a shop where four people are working one list (velista `0044`,
 * section 4.3), and a participant id names a person on this basket without
 * naming anything outside it.
 */
export function toBasketLineView(
  row: GeneratedListLine,
  children: {
    origins: GeneratedListLineOrigin[];
    options: GeneratedListLineOption[];
    /** What the newest settle on this line said, or null if there has been none. */
    lastOutcome?: SettlementOutcome | null;
  },
  seesZoneData: boolean
): GeneratedListBasketLineView {
  const line: GeneratedListBasketLineView = {
    id: row.id,
    content: row.content,
    quantity: row.quantity,
    settledQuantity: row.settledQuantity,
    itemId: row.itemId,
    options: children.options.map((option) => option.itemId),
    position: row.position,
    lastEditedByParticipantId: row.lastEditedByParticipantId,
    lastEditedAt: row.lastEditedAt?.toISOString() ?? null,
    // Not derivable from the numbers: NOT_AVAILABLE closes the outstanding
    // amount exactly as a purchase does, so a row without this would caption a
    // shop that had none as somebody who bought it.
    lastOutcome: children.lastOutcome ?? null,
  };

  if (!seesZoneData) {
    return line;
  }

  return {
    ...line,
    origins: children.origins.map(toOriginView),
    targetListId: row.targetListId,
    origin: row.origin,
  };
}

/**
 * The basket, its people and the reader's own row, in one view (velista `0044`,
 * section 4).
 *
 * One shape rather than three reads because the screen cannot draw a single row
 * without all of it: a line's attribution is a participant id, so the people are
 * this screen's vocabulary rather than a second screen's data.
 */
export function toBasketView(
  row: GeneratedList,
  lines: GeneratedListBasketLineView[],
  people: {
    participants: GeneratedListParticipantView[];
    me: GeneratedListParticipantView;
  },
  seesZoneData: boolean
): GeneratedListBasketView {
  const view: GeneratedListBasketView = {
    id: row.id,
    name: row.name,
    status: row.status,
    generatedAt: row.generatedAt.toISOString(),
    lines,
    participants: people.participants,
    me: people.me,
    seesZoneData,
  };

  // What the run drew from is a list of (zone, list) pairs, so it is zone data
  // and goes under the same rule as the line's three fields.
  return seesZoneData ? { ...view, sourceSnapshot: row.sourceSnapshot } : view;
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
