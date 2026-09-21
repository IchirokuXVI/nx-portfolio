import { Injectable } from '@nestjs/common';
import {
  LineSuggestionReason,
  PURCHASE_SESSION_GAP_MS,
  type LineSuggestionPage,
  type LineSuggestionView,
  type ListSuggestionsRequest,
} from '@portfolio/luna-shopper/contracts';
import { DataSource } from 'typeorm';
import { LineClaimService } from '../../baskets/line-claim.service';
import { ListAccessService } from '../list-access.service';
import {
  daysBetween,
  isStaple,
  mergePurchases,
  periodOf,
  type Purchase,
} from './suggestion-rules';
import {
  STAPLE_SESSION_MIN_LINES,
  STAPLE_TRIPS,
} from './suggestions.constants';
import {
  SUGGESTION_CANDIDATES_SQL,
  SUGGESTION_LAST_ASKED_SQL,
  SUGGESTION_PURCHASES_SQL,
  SUGGESTION_RECENT_TRIPS_SQL,
  type CandidateRow,
  type LastAskedRow,
  type PurchaseRow,
  type RecentTripRow,
} from './suggestions.sql';

/** A suggestion before it is ordered, with the keys the order reads. */
interface Ranked {
  view: LineSuggestionView;
  overdueDays: number;
  position: number;
}

/**
 * The lines a list suggests (plan 0123).
 *
 * A bought line stays on its list at zero, holding its history (plan 0047). This
 * read turns that history into an answer: which of those lines the household is
 * about to want again. A suggestion is never a new line. It is an existing line
 * offering to come back, so nothing is stored and nothing is dismissed.
 *
 * ## Two rules, both pure
 *
 * `periodOf` says a line is due when the median time between its purchases has
 * almost passed. `isStaple` says a line is due whenever it is at zero, because
 * the list's recent trips nearly always want it. Both live in
 * `suggestion-rules.ts` and take a `now` from here, so neither reads a clock and
 * neither knows a calendar day.
 *
 * ## A trip is a basket or a session (plan 0142, section 8)
 *
 * It was a basket alone, so a household that shops from the permanent basket or
 * ticks the list off in the shop had no trips, no staples, and a quantity that
 * always fell back. The widening is one statement's, and neither rule above
 * changed: `isStaple` takes a list of booleans and never knew what a trip was.
 */
@Injectable()
export class SuggestionsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly listAccess: ListAccessService,
    // For `since()` alone: "held by a live basket" is the claim's own window.
    private readonly claims: LineClaimService
  ) {}

  /**
   * Every suggestion of one list, uncapped (plan 0125). `READ`.
   *
   * The rules already run over every candidate, so answering all of them costs
   * no query the capped answer did not already make.
   */
  async list(req: ListSuggestionsRequest): Promise<LineSuggestionPage> {
    await this.listAccess.requireRead(req.listId, req.userId);

    const now = new Date();

    // One after the other, never together: each query draws its own pooled
    // connection, and a request holding several is how the pool runs dry.
    const candidates = await this.dataSource.query<CandidateRow[]>(
      SUGGESTION_CANDIDATES_SQL,
      [req.listId, this.claims.since(), this.claims.skipWindow()]
    );
    if (candidates.length === 0) {
      return { items: [] };
    }

    const lineIds = candidates.map((row) => row.lineId);
    const purchaseRows = await this.dataSource.query<PurchaseRow[]>(
      SUGGESTION_PURCHASES_SQL,
      [lineIds]
    );
    const trips = await this.dataSource.query<RecentTripRow[]>(
      SUGGESTION_RECENT_TRIPS_SQL,
      [
        req.listId,
        lineIds,
        STAPLE_TRIPS,
        PURCHASE_SESSION_GAP_MS,
        now,
        STAPLE_SESSION_MIN_LINES,
      ]
    );
    const asked = await this.dataSource.query<LastAskedRow[]>(
      SUGGESTION_LAST_ASKED_SQL,
      [req.listId, lineIds]
    );

    const purchases = groupPurchases(purchaseRows);
    // The whole row and not the number alone: the rule below asks which basket
    // asked and when, so it can tell a basket that is still the last word on
    // the line from one that a later session has overtaken.
    const askedOf = new Map(asked.map((row) => [row.lineId, row]));
    const presentIn = trips.map((trip) => new Set(trip.lineIds));

    const ranked: Ranked[] = [];
    for (const candidate of candidates) {
      const suggestion = suggest(
        candidate,
        purchases.get(candidate.lineId) ?? [],
        presentIn,
        askedOf.get(candidate.lineId) ?? null,
        now
      );
      if (suggestion) {
        ranked.push(suggestion);
      }
    }

    ranked.sort(bySuggestionOrder);
    return { items: ranked.map((entry) => entry.view) };
  }
}

/** Purchase rows by line, as the rules take them. */
function groupPurchases(rows: readonly PurchaseRow[]): Map<string, Purchase[]> {
  const byLine = new Map<string, Purchase[]>();
  for (const row of rows) {
    const list = byLine.get(row.lineId) ?? [];
    list.push({
      at: new Date(row.settledAt),
      quantity: Number(row.quantity),
      basketId: row.basketId,
    });
    byLine.set(row.lineId, list);
  }
  return byLine;
}

/**
 * One candidate through both rules, or null when neither says it is due.
 *
 * `PERIOD` wins when both hold, because its number says more.
 *
 * ## The quantity (plan 0123 section 5, as plan 0142 section 8.2 narrowed it)
 *
 * What the newest ended **basket** trip asked for the line, but only while that
 * trip is still the last word on it: either it is where the line was last
 * bought, or it is newer than the last purchase. Otherwise the units of the
 * last merged purchase. Never below 1.
 *
 * Without the second half a basket from last spring would decide the quantity
 * for a household that has shopped from the permanent basket every week since,
 * because a session asks for nothing and so can never replace the number.
 */
function suggest(
  candidate: CandidateRow,
  purchases: readonly Purchase[],
  presentIn: readonly ReadonlySet<string>[],
  lastAsked: LastAskedRow | null,
  now: Date
): Ranked | null {
  const merged = mergePurchases(purchases);
  const last = merged[merged.length - 1];
  if (!last) {
    return null;
  }

  const period = periodOf(
    purchases.map((purchase) => purchase.at),
    now
  );
  const presence = presentIn.map((trip) => trip.has(candidate.lineId));
  const staple = isStaple(presence);
  if (!period?.due && !staple) {
    return null;
  }

  const byPeriod = period?.due === true;
  const tripsWith = presence.filter(Boolean).length;
  const askStillStands =
    lastAsked !== null &&
    (lastAsked.tripId === last.basketId ||
      new Date(lastAsked.startedAt).getTime() > last.at.getTime());
  return {
    view: {
      lineId: candidate.lineId,
      reason: byPeriod
        ? LineSuggestionReason.PERIOD
        : LineSuggestionReason.STAPLE,
      periodDays: byPeriod ? period.periodDays : null,
      daysSinceBought: daysBetween(last.at, now),
      tripsWith: byPeriod ? null : tripsWith,
      tripsSeen: byPeriod ? null : presence.length,
      quantity: Math.max(
        1,
        askStillStands && lastAsked ? Number(lastAsked.asked) : last.quantity
      ),
    },
    overdueDays: byPeriod ? period.overdueDays : 0,
    position: Number(candidate.position),
  };
}

/**
 * Section 5's order: `PERIOD` first, most overdue first, then `STAPLE` by how
 * many trips asked for it, then the line's own position, then its id so equal
 * rows still have one answer.
 */
function bySuggestionOrder(a: Ranked, b: Ranked): number {
  const periodA = a.view.reason === LineSuggestionReason.PERIOD;
  const periodB = b.view.reason === LineSuggestionReason.PERIOD;
  if (periodA !== periodB) {
    return periodA ? -1 : 1;
  }
  const primary = periodA
    ? b.overdueDays - a.overdueDays
    : (b.view.tripsWith ?? 0) - (a.view.tripsWith ?? 0);
  if (primary !== 0) {
    return primary;
  }
  if (a.position !== b.position) {
    return a.position - b.position;
  }
  return a.view.lineId < b.view.lineId
    ? -1
    : a.view.lineId > b.view.lineId
      ? 1
      : 0;
}
