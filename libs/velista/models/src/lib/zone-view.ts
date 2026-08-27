import type { ZoneRole } from './enums';
import type { ListRowVm } from './home-view';

/**
 * The view models the group page and the members screen hand to their components.
 *
 * The same rule `home-view.ts` follows (plan 0004, rule D1, section 2.4): the container
 * assembles one object shaped like the **screen**, and a component receives that rather
 * than eight loose inputs. `models` owns these types so that neither `ui` nor
 * `feature-zones` has to import the other.
 *
 * `ListRowVm` is reused rather than redeclared. A list row on the group page is the
 * same row the zone card draws, down to the two counts, and giving it a second type
 * would be two things to keep in step for no gain.
 */

/**
 * The group's header, and everything that decides what the page may offer.
 *
 * **Rule G2 lives in this type.** `isStaff` and `isOwner` are derived from `myRole` and
 * from nothing else, which is what stops a stale count deciding whether a button is
 * drawn. `pendingRequestCount` is kept separately and is the only thing that may decide
 * whether a *number* is drawn, because those two facts arrive on different events and
 * can legitimately disagree for a moment (plan 0010, section 4.3).
 */
export interface GroupHeaderVm {
  readonly id: string;
  readonly name: string;
  /** The letter in the tile. Derived, so no component slices a string itself. */
  readonly initial: string;
  readonly role: ZoneRole;
  readonly memberCount: number;
  readonly joinCode: string;
  /** OWNER or ADMIN. Decides whether the governance row is drawn at all. */
  readonly isStaff: boolean;
  /** OWNER. Decides delete, transfer and every role control (section 5.4). */
  readonly isOwner: boolean;
  /**
   * People waiting to be let in, or `null` for a caller who may not see that.
   *
   * Read only for the number beside the members link. Never as a proxy for a role.
   */
  readonly pendingRequestCount: number | null;
  /** The realtime room was refused, so the page is correct but not live. */
  readonly stale: boolean;
}

/**
 * Why a group is showing no lists, which is two different situations (section 3.2).
 *
 * `no-lists` means the group genuinely has none and anybody here may make the first.
 * `no-access` means it has lists and none of them is shared with this caller, which is
 * the state `ListPreview`'s warning was written for. They render differently because
 * telling the second person "No lists yet" is false and faintly insulting.
 */
export type GroupEmptyReason = 'no-lists' | 'no-access';

/**
 * Every state the group page can be in (section 3.1).
 *
 * A discriminated union for `HomeState`'s reason: independent booleans eventually
 * render two states at once. `gone` is deliberately absent, because it is a navigation
 * rather than a screen: the caller leaves for the dashboard with a notice.
 *
 * `loading` carries an optional header, which is what lets the common path show a named
 * group immediately: arriving from the dashboard, `ZoneStore` already holds the zone,
 * so only the lists need a skeleton.
 */
export type GroupState =
  | { readonly kind: 'loading'; readonly header: GroupHeaderVm | null }
  | {
      /** The caller is in the group but not approved. Requests nothing (section 3.3). */
      readonly kind: 'pending';
      readonly header: GroupHeaderVm;
    }
  | {
      /** `MARKED_FOR_DELETION`. Only an admin can rescue it (section 3.5). */
      readonly kind: 'ownerless';
      readonly header: GroupHeaderVm;
      readonly canClaim: boolean;
    }
  | {
      readonly kind: 'loaded';
      readonly header: GroupHeaderVm;
      readonly lists: readonly ListRowVm[];
    }
  | {
      readonly kind: 'empty';
      readonly header: GroupHeaderVm;
      readonly reason: GroupEmptyReason;
    }
  | {
      readonly kind: 'error';
      /** Shown as "ref {id}" and copyable. Never absent: the client mints one. */
      readonly correlationId: string | null;
    };

/**
 * What a caller may do to one membership, taken from core's own rules (section 5.4).
 *
 * Three of these are more restrictive than a designer would assume, and the type does
 * not encode that: the list is computed per row by the members screen, and an empty
 * list means **no menu at all** rather than a disabled one.
 */
export type MemberAction =
  'makeAdmin' | 'makeMember' | 'transfer' | 'remove' | 'ban' | 'rename';

/** One approved member's row. */
export interface MemberRowVm {
  readonly membershipId: string;
  readonly userId: string;
  /** The per zone username, which is the only human readable name the API exposes. */
  readonly name: string;
  readonly initial: string;
  readonly role: ZoneRole;
  /** Labelled "You", so somebody can find themselves in a long list. */
  readonly isYou: boolean;
  /** Empty means the row has no menu. See {@link MemberAction}. */
  readonly actions: readonly MemberAction[];
  /** A write is in flight for this row. The rest of the screen stays usable. */
  readonly busy: boolean;
}

/** One person waiting to be let in. Only ever built for a staff caller. */
export interface PendingRequestRowVm {
  readonly membershipId: string;
  readonly name: string;
  readonly initial: string;
  readonly busy: boolean;
}

/** Every state the members screen can be in (section 3.4). */
export type MembersState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'loaded';
      /** For the title, which is a whole phrase with the name inside it. */
      readonly groupName: string;
      /** Empty means the section is **absent**, not an empty state with a message. */
      readonly pending: readonly PendingRequestRowVm[];
      readonly members: readonly MemberRowVm[];
      /** A group large enough to page is rare, and the screen still has to do it. */
      readonly hasMore: boolean;
      readonly loadingMore: boolean;
    }
  | { readonly kind: 'error'; readonly correlationId: string | null };
