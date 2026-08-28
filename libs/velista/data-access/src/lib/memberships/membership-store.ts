import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import type { Membership, MembershipStatus } from '@portfolio/velista/models';
import { SessionStore } from '../auth/session-store';
import type { RealtimeClientI } from '../realtime/realtime-client';
import { REALTIME_CLIENT } from '../realtime/realtime-client';
import type { RealtimeEvent } from '../realtime/realtime-events';
import {
  MEMBERSHIP_SERVICE,
  type MembershipServiceI,
} from './membership-service';

/** How one zone's member list is going. `ListStore`'s four states, for its reason. */
export type MemberLoadState = 'idle' | 'loading' | 'loaded' | 'failed';

const NO_MEMBERS: readonly Membership[] = [];

/** The statuses a zone's rows were asked for, which decides what an event may add. */
const DEFAULT_STATUSES: readonly MembershipStatus[] = ['APPROVED'];

/**
 * Who is in a zone, live (plan 0018, gap 1).
 *
 * ## Why the rows are here and not on the members screen
 *
 * They were page state, and the screen learned about exactly one event, the rename,
 * through a one shot channel on `ZoneStore`. Five more channels was the obvious way to
 * finish the job and the wrong one: a signal holds only its latest value, so two
 * membership events in one turn deliver the second and drop the first, and joins and
 * departures arrive in bursts precisely when a group is busy. A rename could survive
 * that. A queue of join requests cannot.
 *
 * So the rows moved to where a record the server can change belongs (plan 0004, section
 * 7.1), and the rule the old comment stated is kept intact: every screen still learns
 * about the stream through a store, never through its own subscription.
 *
 * ## The status filter is part of the state
 *
 * Rule G2: `PENDING` is staff only, so this screen asks for `APPROVED` alone as an
 * ordinary member. The filter each zone was loaded under is therefore remembered, and
 * every event is answered against it. Without that, `member.joined` for a pending
 * membership would insert a join request into a list an ordinary member may not see,
 * which is a permission decision made by accident in a client.
 *
 * ## What the store does not do
 *
 * It does not sort. The server orders the page and the store preserves that order,
 * appending an arrival at the end of what is loaded. A new row landing below the last
 * one rather than in its server-side position is a smaller wrong than re-sorting a page
 * by a key this client is guessing at.
 */
// Provided by the app layer, never root: rule D5, plan 0004 section 9. It resolves
// `MEMBERSHIP_SERVICE` and `REALTIME_CLIENT`, so at the root it would serve fixture
// members beside a real session.
@Injectable()
export class MembershipStore {
  private readonly _members = inject<MembershipServiceI>(MEMBERSHIP_SERVICE);
  private readonly _realtime = inject<RealtimeClientI>(REALTIME_CLIENT);
  private readonly _session = inject(SessionStore);
  private readonly _destroyRef = inject(DestroyRef);

  private readonly _byZone = signal<ReadonlyMap<string, readonly Membership[]>>(
    new Map()
  );
  private readonly _state = signal<ReadonlyMap<string, MemberLoadState>>(
    new Map()
  );
  private readonly _error = signal<ReadonlyMap<string, unknown>>(new Map());
  private readonly _cursor = signal<ReadonlyMap<string, string | null>>(
    new Map()
  );

  /**
   * The statuses each zone's rows were asked for.
   *
   * Not a signal: nothing renders it, and it is read only while an event is being
   * applied. Making it one would invite a component to branch on it, which is how a
   * client ends up re-deriving a permission the server already decided.
   */
  private readonly _statuses = new Map<string, readonly MembershipStatus[]>();

  /** Whether a further page is in flight, per zone. */
  private readonly _loadingMore = signal<ReadonlySet<string>>(new Set());

  constructor() {
    // By hand, not `takeUntilDestroyed`: `@angular/core/rxjs-interop` is a secondary
    // entry point module federation does not dedupe, and a service several remotes
    // provide throws `NG0203` from it with a perfectly correct DI graph.
    const subscription = this._realtime.events.subscribe((event) =>
      this._apply(event)
    );
    this._destroyRef.onDestroy(() => subscription.unsubscribe());

    // Emptied when the identity changes, sign out included.
    //
    // This store is the first whose rows are drawn **before** their reload lands, which
    // is what makes coming back into a group show the list rather than a skeleton. The
    // same property would show one account the previous account's member list for the
    // frame between a sign in and its first page, and a list of names is exactly the
    // wrong thing to be casual about.
    let seen = untracked(() => this._session.userId());
    effect(() => {
      const userId = this._session.userId();
      untracked(() => {
        if (userId !== seen) {
          seen = userId;
          this._forgetEverything();
        }
      });
    });
  }

  /** One zone's members, in the order the server gave them. Empty until loaded. */
  membersIn(zoneId: string): readonly Membership[] {
    return this._byZone().get(zoneId) ?? NO_MEMBERS;
  }

  /** How that zone's load is going. `idle` is the instant before one is started. */
  stateOf(zoneId: string): MemberLoadState {
    return this._state().get(zoneId) ?? 'idle';
  }

  /** Why the last load for that zone failed, or null. */
  errorOf(zoneId: string): unknown {
    return this._error().get(zoneId) ?? null;
  }

  /** The next page's cursor, or null when there is no more to read. */
  cursorOf(zoneId: string): string | null {
    return this._cursor().get(zoneId) ?? null;
  }

  /** Whether another page is on its way. */
  loadingMoreIn(zoneId: string): boolean {
    return this._loadingMore().has(zoneId);
  }

  /** A signal view of one zone, for a container that reads it in a `computed`. */
  forZone(zoneId: string) {
    return computed(() => ({
      members: this.membersIn(zoneId),
      state: this.stateOf(zoneId),
      error: this.errorOf(zoneId),
      hasMore: this.cursorOf(zoneId) !== null,
      loadingMore: this.loadingMoreIn(zoneId),
    }));
  }

  /**
   * Load one zone's members under a status filter.
   *
   * The filter is recorded before the request rather than after it, so an event that
   * arrives while the page is in flight is judged against what was asked for.
   */
  async load(
    zoneId: string,
    statuses: readonly MembershipStatus[] = DEFAULT_STATUSES
  ): Promise<void> {
    this._statuses.set(zoneId, statuses);
    this._set(this._state, zoneId, 'loading');
    this._set(this._error, zoneId, null);

    try {
      const page = await this._members.listMembers(zoneId, { statuses });
      this._setMembers(zoneId, page.items);
      this._set(this._cursor, zoneId, page.nextCursor);
      this._set(this._state, zoneId, 'loaded');
    } catch (error) {
      this._set(this._error, zoneId, error);
      this._set(this._state, zoneId, 'failed');
      throw error;
    }
  }

  /**
   * Another page, appended.
   *
   * Silent about its own failure, unlike {@link load}: the rows already on screen stay
   * readable, and a screen that replaced them with an error panel because the second
   * page failed would be throwing away what it has.
   */
  async loadMore(zoneId: string): Promise<void> {
    const cursor = this.cursorOf(zoneId);
    if (cursor === null || this.loadingMoreIn(zoneId)) {
      return;
    }

    this._loadingMore.update((current) => new Set(current).add(zoneId));
    try {
      const page = await this._members.listMembers(zoneId, {
        cursor,
        statuses: this._statuses.get(zoneId) ?? DEFAULT_STATUSES,
      });
      this._setMembers(zoneId, [...this.membersIn(zoneId), ...page.items]);
      this._set(this._cursor, zoneId, page.nextCursor);
    } catch (error) {
      this._set(this._error, zoneId, error);
      throw error;
    } finally {
      this._loadingMore.update((current) => {
        const next = new Set(current);
        next.delete(zoneId);
        return next;
      });
    }
  }

  /**
   * Write one membership the caller just changed themselves.
   *
   * The same path an event takes, deliberately: a role set through this screen and a
   * role set from another device have to land the same way, or the two differ in
   * exactly the case nobody tests.
   */
  record(membership: Membership): void {
    this._upsert(membership);
  }

  private _forgetEverything(): void {
    this._byZone.set(new Map());
    this._state.set(new Map());
    this._error.set(new Map());
    this._cursor.set(new Map());
    this._statuses.clear();
  }

  /** Forget a zone's rows. For a screen leaving a group it no longer belongs to. */
  forget(zoneId: string): void {
    this._byZone.update((current) => {
      const next = new Map(current);
      next.delete(zoneId);
      return next;
    });
    this._statuses.delete(zoneId);
  }

  private _apply(event: RealtimeEvent): void {
    switch (event.type) {
      case 'member.joined':
      case 'member.approved':
      case 'member.kicked':
      case 'member.banned':
      case 'member.roleChanged':
      case 'member.usernameChanged':
        // Every one of these carries the membership in its **new** state, so one
        // branch answers all six and the status decides whether it is a row or a
        // departure. `member.kicked` is the case worth naming: the row has to go, and
        // before this store it stayed on screen with a working actions menu whose
        // every entry failed against a membership that no longer existed.
        this._upsert(event.membership);
        return;

      case 'member.rejected':
        // No zone id on this payload, which is why `ZoneStore` correctly leaves it
        // alone: a summary cannot be corrected without knowing whose it is. A **row**
        // can, because a membership id is unique and is all a removal needs, so the
        // join request queue empties the moment another admin answers it.
        this._removeEverywhere(event.membershipId);
        return;

      default:
        // Zone, list, line, comment, merge and presence traffic, each owned by the
        // store that holds the records it changes.
        return;
    }
  }

  /**
   * Put a membership where it belongs, or take it away.
   *
   * The status filter is the whole of the decision. A membership whose status the
   * screen did not ask for is not an update to hide, it is a row to remove: a kick
   * arrives as the membership in its KICKED state, and under an `APPROVED` filter that
   * means the person is gone.
   */
  private _upsert(membership: Membership): void {
    const zoneId = membership.zoneId;
    if (!this._byZone().has(zoneId)) {
      // An event for a zone that was never loaded. The store holds what was asked for,
      // and building a one row zone out of an event would render a group of nine as a
      // group of one.
      return;
    }

    const statuses = this._statuses.get(zoneId) ?? DEFAULT_STATUSES;
    if (!statuses.includes(membership.status)) {
      this._setMembers(
        zoneId,
        this.membersIn(zoneId).filter((row) => row.id !== membership.id)
      );
      return;
    }

    const current = this.membersIn(zoneId);
    const index = current.findIndex((row) => row.id === membership.id);
    this._setMembers(
      zoneId,
      index < 0
        ? [...current, membership]
        : current.map((row) => (row.id === membership.id ? membership : row))
    );
  }

  private _removeEverywhere(membershipId: string): void {
    for (const [zoneId, rows] of this._byZone()) {
      if (rows.some((row) => row.id === membershipId)) {
        this._setMembers(
          zoneId,
          rows.filter((row) => row.id !== membershipId)
        );
      }
    }
  }

  private _setMembers(zoneId: string, members: readonly Membership[]): void {
    this._byZone.update((current) => new Map(current).set(zoneId, members));
  }

  private _set<T>(
    target: ReturnType<typeof signal<ReadonlyMap<string, T>>>,
    zoneId: string,
    value: T
  ): void {
    target.update((current) => new Map(current).set(zoneId, value));
  }
}
