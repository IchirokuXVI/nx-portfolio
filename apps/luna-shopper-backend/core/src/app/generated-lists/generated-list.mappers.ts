import type {
  GeneratedListBasketLineView,
  GeneratedListBasketView,
  GeneratedListLineOriginView,
  GeneratedListLineView,
  GeneratedListParticipantView,
  GeneratedListSourceName,
  GeneratedListSummaryView,
  GeneratedListView,
  SettlementOutcome,
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
 * Both attributions are always present, for everybody. "Who got the bread" and
 * "who put this here" are the two questions a shop where four people are working
 * one list actually asks (velista `0044`, section 4.3; plan 0055, section 4),
 * and a participant id names a person on this basket without naming anything
 * outside it.
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
    // Written once and never afterwards, which is why it is a second field and
    // not a reuse of the one below (plan 0055, section 4): that one becomes
    // whoever settles the line, and then nobody can say who typed it.
    createdByParticipantId: row.createdByParticipantId,
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
  seesZoneData: boolean,
  sourceNames: GeneratedListSourceName[] = []
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

  // What the run drew from is a list of (zone, list) pairs, and the names behind
  // them are the plainest zone data there is. Both go under the same rule as the
  // line's three fields.
  return seesZoneData
    ? { ...view, sourceSnapshot: row.sourceSnapshot, sourceNames }
    : view;
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
