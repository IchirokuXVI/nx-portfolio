import type { LineStatus, MembershipStatus, ZoneRole } from './enums';

/**
 * The view models the home page hands to its components.
 *
 * Plan 0004 rule D1, section 2.4: the container assembles one `computed` shaped like
 * the **page**, not like the API, so a zone card receives one object rather than eight
 * separate inputs. `models` owns these types, which is what plan 0001 section 7 means
 * by "the mapping from contract DTOs to what components consume".
 *
 * Every count here is **optional**, and that is not a temporary shim. The gateway
 * cannot serve them yet (plan 0003, section 5.2), and even once it can, a summary that
 * has not arrived looks exactly like one the backend could not produce. A component
 * that renders correctly without a number is right in both cases, and it is the only
 * version that survives the counts landing.
 */

/** One list row inside a zone card, and inside the resume card. */
export interface ListRowVm {
  readonly id: string;
  readonly name: string;
  /** Absent until the backend serves counts. Render the row without it. */
  readonly lineCount?: number;
  readonly readyCount?: number;
}

/** Who is waiting to be let into a zone. Absent when nobody is. */
export interface JoinRequestVm {
  /**
   * The **oldest** requester's name. Plan 0003 section 4.1: taking whoever arrives
   * first makes the name change on every reload and the row look broken.
   */
  readonly firstName: string;
  /**
   * How many others are waiting, **excluding** the named person. Zero renders the
   * singular phrasing, which is a different translation key because the verb agrees
   * with the count in both English and Spanish.
   */
  readonly othersCount: number;
}

/** A group card. The code says zone throughout (rule N2, plan 0001). */
export interface ZoneCardVm {
  readonly id: string;
  readonly name: string;
  /** The letter in the tile. Derived, so the component never slices a string itself. */
  readonly initial: string;
  readonly role: ZoneRole;
  readonly membership: MembershipStatus;
  readonly memberCount?: number;
  readonly listCount?: number;
  readonly lists: readonly ListRowVm[];
  /** Only ever set for a caller who can act on it, so the row implies the permission. */
  readonly joinRequests?: JoinRequestVm;
  /**
   * Whether tapping the card goes anywhere.
   *
   * False for a membership still `PENDING`, and false for a zone that is
   * `MARKED_FOR_DELETION` or whose status this build does not recognise. Plan 0003
   * open question 2 asks only that the page not break on the latter; a card that
   * cannot be opened is how that is honoured.
   */
  readonly tappable: boolean;
  /** Set while the caller's membership is pending, for "Waiting for {name} to let you in". */
  readonly waitingOn?: string;
}

/** The resume card: the fastest path back into the list someone was using. */
export interface ResumeListVm {
  readonly listId: string;
  readonly listName: string;
  readonly zoneName: string;
  readonly lineCount?: number;
  readonly readyCount?: number;
  /** Who is in that list right now. Advisory only (plan 0004, section 6.7). */
  readonly shoppers: readonly string[];
}

/** One line in the illustrative preview on the anonymous screen. */
export interface PreviewLineVm {
  readonly content: string;
  readonly quantity: string;
  readonly status: LineStatus;
  /** The initial in the little avatar, or null for a line nobody has touched. */
  readonly by: string | null;
}

/**
 * Every state the home page can be in.
 *
 * Plan 0003 section 4: the page component holds no presentation logic beyond choosing
 * which of these to render. Making that a discriminated union rather than a handful of
 * booleans is what stops the page rendering two states at once, which is the failure
 * a set of independent flags eventually produces.
 *
 * The connection-lost state is deliberately **not** here. It is blocking, it covers
 * every page rather than this one, and it is rendered by the app layout
 * (plan 0003, section 3.1).
 *
 * `anonymous` used to be one of these. It is now a **page** of its own, reached at the
 * app's mount and enforced by a route guard rather than by a `@switch` in a template
 * (plan 0007, section 1). Nobody who is not signed in reaches the dashboard at all, so
 * a state for them here would be unreachable.
 */
export type HomeState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'empty'; readonly guest: boolean }
  | {
      readonly kind: 'populated';
      readonly resume: ResumeListVm | null;
      readonly zones: readonly ZoneCardVm[];
      readonly guest: boolean;
    }
  | {
      readonly kind: 'error';
      /** Shown as "ref {id}" and copyable. Never absent: the client mints one. */
      readonly correlationId: string | null;
    };
