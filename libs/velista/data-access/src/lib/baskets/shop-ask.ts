/**
 * What decides whether the first buy of a trip asks where the person is
 * (velista `0141`, section 1).
 *
 * Four facts, each read where it lives: the shop chosen in the view, the basket's
 * own shop, the device's "Don't ask again" and the answer remembered for this trip.
 */
export interface ShopAskFacts {
  /** A shop is chosen in the view, by the filter or by an earlier answer. */
  readonly shopChosen: boolean;
  /** The basket was started at a shop, which nobody can change. */
  readonly basketHasShop: boolean;
  /** This device answered "Don't ask again". */
  readonly neverAsk: boolean;
  /** The question was answered with no shop less than a trip ago. */
  readonly answeredForTrip: boolean;
}

/**
 * Whether a press that writes a buy opens the shop question first.
 *
 * Only when nothing says where the buy happens and nothing says not to ask.
 */
export function asksForShop(facts: ShopAskFacts): boolean {
  return (
    !facts.shopChosen &&
    !facts.basketHasShop &&
    !facts.neverAsk &&
    !facts.answeredForTrip
  );
}

/** What the device flag holds once "Don't ask again" was pressed. */
export const SHOP_ASK_OFF = 'true';
