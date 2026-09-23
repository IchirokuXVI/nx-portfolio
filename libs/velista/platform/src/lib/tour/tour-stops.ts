import type { MyZone } from '@portfolio/velista/models';

/**
 * The ids an element may declare itself by with `libTourAnchor` (velista `0099`,
 * section 2).
 *
 * A closed set, so a stop and the attribute it points at cannot name two different
 * strings. A catalog stop (`0100`) is one more id here and one more attribute.
 */
export type TourAnchorId =
  | 'nav'
  | 'groups'
  | 'group-lists'
  | 'basket-tab'
  | 'assistant'
  | 'list-composer';

/** Where the card sits beside the lit control. */
export type TourPlacement = 'above' | 'below';

/**
 * What the account holds when a run starts, which is what decides the stops.
 *
 * Written by `app-providers.ts` from the zone store, because `platform` may not read
 * `data-access`. Null while the zones have not been read.
 */
export interface TourHoldings {
  /** Whether the account is in at least one group. */
  readonly hasGroup: boolean;
  /** A list the account can open, for the stops that point inside one, or null. */
  readonly firstList: {
    readonly zoneId: string;
    readonly listId: string;
  } | null;
}

/** One card of the tour. */
export interface TourStop {
  /** The stop's own id, which is also the prefix of its two copy keys. */
  readonly id: string;
  /** The element the card lights. */
  readonly anchor: TourAnchorId;
  /**
   * The screen to be on, as segments after the locale, from what the account holds.
   *
   * Null when the account holds nothing this stop can point at, which drops the stop
   * before the first card is drawn (section 3).
   */
  readonly route: (holdings: TourHoldings) => readonly string[] | null;
  readonly placement: TourPlacement;
  readonly titleKey: string;
  readonly bodyKey: string;
}

const HOME = ['home'] as const;

/**
 * The tour, in the order it plays (section 3).
 *
 * **The tour points at what is there, and never fakes a screen.** A stop whose route
 * answers null for this account is left out, so a new account with no group sees four
 * cards and somebody with a group and a list sees six.
 */
export const TOUR_STOPS: readonly TourStop[] = [
  {
    id: 'nav',
    anchor: 'nav',
    route: () => HOME,
    placement: 'above',
    titleKey: 'tour.nav.title',
    bodyKey: 'tour.nav.body',
  },
  {
    id: 'groups',
    anchor: 'groups',
    route: () => HOME,
    placement: 'below',
    titleKey: 'tour.groups.title',
    bodyKey: 'tour.groups.body',
  },
  {
    // The list rows live on a group card, so a group with no list has none to light.
    id: 'lists',
    anchor: 'group-lists',
    route: (holdings) =>
      holdings.hasGroup && holdings.firstList !== null ? HOME : null,
    placement: 'below',
    titleKey: 'tour.lists.title',
    bodyKey: 'tour.lists.body',
  },
  {
    id: 'basket',
    anchor: 'basket-tab',
    route: () => ['shopping-lists', 'current'],
    placement: 'above',
    titleKey: 'tour.basket.title',
    bodyKey: 'tour.basket.body',
  },
  {
    id: 'assistant',
    anchor: 'assistant',
    route: () => HOME,
    placement: 'below',
    titleKey: 'tour.assistant.title',
    bodyKey: 'tour.assistant.body',
  },
  {
    // Not shown to a new account: there is no list whose composer it could light.
    id: 'voice',
    anchor: 'list-composer',
    route: ({ firstList }) =>
      firstList === null
        ? null
        : ['zones', firstList.zoneId, 'lists', firstList.listId],
    placement: 'above',
    titleKey: 'tour.voice.title',
    bodyKey: 'tour.voice.body',
  },
];

/**
 * What the account holds, read from its groups.
 *
 * Only a group the person is in counts: a request still waiting has no lists to show
 * and no card that opens. The list is the first one on such a group, which is the
 * first list the home page draws for it.
 */
export function tourHoldingsOf(zones: readonly MyZone[]): TourHoldings {
  const joined = zones.filter(
    (zone) => zone.myStatus === 'APPROVED' && zone.status === 'ACTIVE'
  );
  const withList = joined.find((zone) => zone.lists.length > 0);
  const list = withList?.lists[0];

  return {
    hasGroup: joined.length > 0,
    firstList:
      withList === undefined || list === undefined
        ? null
        : { zoneId: withList.id, listId: list.id },
  };
}

/** A stop settled for one run, with the screen it is on. */
export interface PlannedStop {
  readonly stop: TourStop;
  readonly route: readonly string[];
}

/**
 * The stops one run plays, computed once when it starts.
 *
 * Pure, so the rule that decides the count on every card is tested without a router.
 */
export function planTour(
  holdings: TourHoldings,
  stops: readonly TourStop[] = TOUR_STOPS
): readonly PlannedStop[] {
  return stops.flatMap((stop) => {
    const route = stop.route(holdings);
    return route === null ? [] : [{ stop, route }];
  });
}
