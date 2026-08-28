/**
 * What the account screen hands to its template (plan 0015, section 3).
 *
 * Rule D1, section 2.4: the container assembles one `computed` shaped like the
 * **screen**, and the template switches on `kind` rather than re-deriving who is
 * looking at it from three separate signals.
 *
 * The union has two members and not one with flags on it, because **the guest's screen
 * is a different screen** (section 3.2). A guest has no email, no password and no way
 * back into their account, so four of the six rows are meaningless for them and the
 * fifth, sign out, is a trap. Modelling that as `email: null` would let a template
 * render the rows anyway; modelling it as a separate member means the rows have nowhere
 * to come from.
 */

/** How far `GET /v1/account/me` has got. Only the email row depends on it. */
export type ProfileLoad = 'loading' | 'loaded' | 'failed';

/**
 * The screen for somebody with credentials of their own.
 *
 * `name` never has a loading state: it is derived from the token pair, which is
 * already in memory, so the heading and the app bar's initial are correct on the first
 * frame. `email` is the one fact the app genuinely does not have, which is why it is
 * the only thing here that skeletons.
 */
export interface RegisteredAccountVm {
  readonly kind: 'registered';
  readonly name: string;
  readonly profile: ProfileLoad;
  /** Null while loading, after a failure, and for an account with no address. */
  readonly email: string | null;
  readonly emailVerified: boolean;
}

/**
 * The guest's screen.
 *
 * `zoneCount` is read from the zone cache and carried here so the upgrade card can say
 * what is at stake, in the same sentence `0009` put on the upgrade screen itself.
 */
export interface GuestAccountVm {
  readonly kind: 'guest';
  readonly name: string;
  readonly zoneCount: number;
}

export type AccountVm = RegisteredAccountVm | GuestAccountVm;
