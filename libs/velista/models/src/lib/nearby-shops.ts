import type { BasketShop } from './basket-view';

/**
 * The shops near the device and the ones this person bought at (velista `0103`;
 * backend `0164`, sections 2 and 4).
 *
 * Rule D4: ours, mapped from `unknown` at the boundary. The wire names them
 * `NearbyShopsView` and `RecentShopsView`; here they are what the picker draws.
 */

/**
 * Why the server chose no shop, one sentence each in the picker.
 *
 * - `NONE_NEARBY`: nothing within {@link NEARBY_RADIUS_METRES}.
 * - `LOW_ACCURACY`: the device was not sure enough of itself.
 * - `AMBIGUOUS`: several shops are close, or the one shop is not close enough.
 * - `OUTSIDE_PROFILE`: the clear shop is outside the owner's areas, so it is a
 *   candidate and not a pick.
 */
export const NEARBY_NO_PICK_REASONS = [
  'NONE_NEARBY',
  'LOW_ACCURACY',
  'AMBIGUOUS',
  'OUTSIDE_PROFILE',
] as const;

export type NearbyNoPick = (typeof NEARBY_NO_PICK_REASONS)[number];

/**
 * How far the server looks, which the picker's section heading states.
 *
 * The server's number (backend `0164`, section 3), repeated here only to be said
 * out loud. **Nothing on this side filters or decides by it**: the candidates are
 * whatever the answer holds.
 */
export const NEARBY_RADIUS_METRES = 750;

/** One shop near the device: the shop, how far, and whether the profile refuses it. */
export interface NearbyShop extends BasketShop {
  /** From the device to the shop, rounded to the metre by the server. */
  readonly distanceMetres: number;
  /**
   * The profile refuses this shop (backend `0064`). Still a candidate, and one a
   * person may choose by hand; never the server's pick.
   */
  readonly excluded: boolean;
}

/**
 * The server's answer to "where am I" (backend `0164`, section 2).
 *
 * **The client never decides the pick.** Exactly one of {@link pick} and
 * {@link noPick} is set, and the picker draws whichever it was given. A pick names
 * one of the candidates; one that does not (an answer this build cannot square)
 * is read as no pick at all by {@link nearbyPickedShop}.
 */
export interface NearbyShops {
  /** Nearest first, as the server ordered them. */
  readonly candidates: readonly NearbyShop[];
  readonly pick: {
    readonly locationId: string;
    readonly distanceMetres: number;
  } | null;
  readonly noPick: NearbyNoPick | null;
}

/**
 * The shop the server picked, from the candidates, or null for no pick.
 *
 * Null too when the pick names no candidate: the message after a pick names the
 * shop and its street, and a pick this device cannot name is one the person could
 * not check, so it is drawn as the candidates instead.
 */
export function nearbyPickedShop(answer: NearbyShops): NearbyShop | null {
  const pick = answer.pick;
  if (pick === null) {
    return null;
  }
  return answer.candidates.find((shop) => shop.id === pick.locationId) ?? null;
}

/** One shop this person bought at in the last 60 days (backend `0164`, section 4). */
export interface RecentShop {
  readonly shop: BasketShop;
  /** The latest purchase there, which is what the list is ordered by. */
  readonly lastBoughtAt: Date;
}

/**
 * A distance as the picker prints it: "120 m", "120 m" in Spanish too.
 *
 * `Intl` with the unit, so the space and the symbol are the language's own. Every
 * candidate is within {@link NEARBY_RADIUS_METRES}, so metres are always the unit.
 */
export function formatDistance(metres: number, locale: string): string {
  const rounded = Math.round(metres);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: 'meter',
      unitDisplay: 'short',
    }).format(rounded);
  } catch {
    return `${rounded} m`;
  }
}

/**
 * When a recent shop was last bought at, in the words the picker uses.
 *
 * `today` and `yesterday` are words the screen translates. Inside the last week
 * the weekday ("Tuesday"), and anything older the date ("Sep 2" in English), both from `Intl`
 * in the reader's language. Calendar days in the device's zone, because "today"
 * means the reader's today.
 *
 * @param now Passed in rather than read, so a spec can stand on any day.
 */
export type RecentShopDay =
  | { readonly kind: 'today' }
  | { readonly kind: 'yesterday' }
  | { readonly kind: 'date'; readonly text: string };

export function recentShopDay(
  at: Date,
  locale: string,
  now: Date = new Date()
): RecentShopDay {
  const days = Math.round(
    (startOfDay(now).getTime() - startOfDay(at).getTime()) / 86_400_000
  );
  if (days <= 0) {
    return { kind: 'today' };
  }
  if (days === 1) {
    return { kind: 'yesterday' };
  }

  const options: Intl.DateTimeFormatOptions =
    days < 7 ? { weekday: 'long' } : { day: 'numeric', month: 'short' };
  let text: string;
  try {
    text = new Intl.DateTimeFormat(locale, options).format(at);
  } catch {
    text = new Intl.DateTimeFormat(undefined, options).format(at);
  }
  return { kind: 'date', text: capitalised(text) };
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** "martes" standing alone at the end of a row reads as a fragment; "Martes" does not. */
function capitalised(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}
