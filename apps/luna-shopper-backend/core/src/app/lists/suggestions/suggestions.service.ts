import { Injectable } from '@nestjs/common';
import {
  LineSuggestionReason,
  LIVE_GENERATED_LIST_STATUSES,
  type LineSuggestionPage,
  type LineSuggestionView,
  type ListSuggestionsRequest,
} from '@portfolio/luna-shopper/contracts';
import { DataSource } from 'typeorm';
import { LineClaimService } from '../../generated-lists/line-claim.service';
import { ListAccessService } from '../list-access.service';
import {
  daysBetween,
  isStaple,
  mergePurchases,
  periodOf,
  type Purchase,
} from './suggestion-rules';
import { STAPLE_TRIPS } from './suggestions.constants';
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
 * the list's recent baskets nearly always ask for it. Both live in
 * `suggestion-rules.ts` and take a `now` from here, so neither reads a clock and
 * neither knows a calendar day.
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
    const live = [[...LIVE_GENERATED_LIST_STATUSES], this.claims.since()];

    // One after the other, never together: each query draws its own pooled
    // connection, and a request holding several is how the pool runs dry.
    const candidates = await this.dataSource.query<CandidateRow[]>(
      SUGGESTION_CANDIDATES_SQL,
      [req.listId, ...live]
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
      [req.listId, ...live, lineIds, STAPLE_TRIPS]
    );
    const asked = await this.dataSource.query<LastAskedRow[]>(
      SUGGESTION_LAST_ASKED_SQL,
      [req.listId, ...live, lineIds]
    );

    const purchases = groupPurchases(purchaseRows);
    const askedOf = new Map(
      asked.map((row) => [row.lineId, Number(row.asked)])
    );
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
    list.push({ at: new Date(row.settledAt), quantity: Number(row.quantity) });
    byLine.set(row.lineId, list);
  }
  return byLine;
}

/**
 * One candidate through both rules, or null when neither says it is due.
 *
 * `PERIOD` wins when both hold, because its number says more. `quantity` is what
 * the newest ended basket asked for the line, else the units of its last merged
 * purchase, and never below 1.
 */
function suggest(
  candidate: CandidateRow,
  purchases: readonly Purchase[],
  presentIn: readonly ReadonlySet<string>[],
  lastAsked: number | null,
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
      quantity: Math.max(1, lastAsked ?? last.quantity),
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
