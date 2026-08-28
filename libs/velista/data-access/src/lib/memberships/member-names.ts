import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import type { Membership, ZoneRole } from '@portfolio/velista/models';
import {
  REALTIME_CLIENT,
  type RealtimeClientI,
} from '../realtime/realtime-client';
import type { RealtimeEvent } from '../realtime/realtime-events';
import {
  MEMBERSHIP_SERVICE,
  type MembershipServiceI,
} from './membership-service';

/**
 * Who a user id belongs to, per zone (plan 0012, section 5.4).
 *
 * ## Why this exists at all
 *
 * `CommentView` carries `authorUserId` and no username. `LineView` carries
 * `createdByUserId` and no username. There is no profile endpoint. The **only** place
 * in the entire API where a user id is paired with a human name is `MembershipView`,
 * so a comment sheet built from the comment endpoint alone can say only that
 * `e3f1...` wants the big one.
 *
 * So the zone's members are loaded once and turned into a map. One request per zone, on
 * a screen already making two, and it is reused by the share sheet, which needs the
 * same list for a different reason.
 *
 * ## Names are per zone, and that is not an implementation detail
 *
 * A membership's `username` is the name that person goes by **in that group**, and the
 * same person is called something else in another one. The cache is therefore keyed by
 * zone and nothing may read a name out of one zone to render it in another.
 *
 * ## Why it does not filter to APPROVED
 *
 * The obvious request is `statuses=APPROVED`, and it is wrong here. A comment outlives
 * its author's membership: somebody who commented and then left the group would lose
 * their name from every comment they ever wrote, which is the exact failure this class
 * exists to prevent. So it asks for everybody it is allowed to see, and falls back
 * gracefully for the rest.
 *
 * Asking for a status other than the default is **staff only** at the gateway: a plain
 * member requesting one gets a `forbidden` rather than a filtered page. So the request
 * is made without a `statuses` parameter at all, which is the one form every caller may
 * make, and a departed member resolves only where the backend keeps the row visible.
 * A name that cannot be resolved is not an error and never renders as an id.
 *
 * ## It listens, because "once per session" was too long (plan 0026)
 *
 * `ensure` is idempotent for a good reason and was permanent for no reason: a zone
 * asked for once was never asked again, so **somebody who joined the group afterwards
 * had no name for the rest of the session**. Every surface drawn from a name then
 * dropped them, quietly and by design, since `presenceNames` leaves out whoever it
 * cannot name. The report that found this was an owner who accepted a request and
 * then could not see the new member's presence indicator, but their comments and the
 * lines they added were equally anonymous.
 *
 * The six membership events carry a whole `Membership`, username included, so keeping
 * up costs no request at all: the name is in the event that announces the person. Only
 * zones already asked for are updated. A zone nobody has loaded must not acquire a
 * one entry cache from a passing event, because `membersOf` would then hand the share
 * sheet a single row and look complete rather than empty.
 */
@Injectable()
export class MemberNames {
  private readonly _members = inject<MembershipServiceI>(MEMBERSHIP_SERVICE);
  private readonly _realtime = inject<RealtimeClientI>(REALTIME_CLIENT);
  private readonly _destroyRef = inject(DestroyRef);

  constructor() {
    // By hand rather than `takeUntilDestroyed`, for the reason `PresenceStore` and
    // both transports give: `@angular/core/rxjs-interop` is a secondary entry point
    // module federation does not dedupe, so it throws `NG0203` from a service several
    // remotes provide, with a perfectly correct DI graph.
    const subscription = this._realtime.events.subscribe((event) =>
      this._apply(event)
    );
    this._destroyRef.onDestroy(() => subscription.unsubscribe());
  }

  /**
   * The whole membership per user, not merely the name.
   *
   * It held a `userId -> username` map until the list header started drawing a role
   * beside each name. Two parallel signals would have been the smaller diff and the
   * worse one: they are filled from the same rows by the same method, so the only thing
   * a second map could ever do is disagree with the first.
   *
   * Still keyed by **user** id rather than membership id, which `_raw` already is: every
   * caller here starts from a user id, because that is what a comment, a line and a
   * presence payload carry.
   */
  private readonly _byZone = signal<
    ReadonlyMap<string, ReadonlyMap<string, Membership>>
  >(new Map());

  /** Zones whose request is in flight or done, so it is made once rather than per row. */
  private readonly _asked = new Set<string>();

  /**
   * The name that user goes by in that zone, or null.
   *
   * Null is a first class answer and covers three different situations that the caller
   * must **not** try to tell apart: the members have not arrived yet, the person left
   * the group, and the backend declined to name them. All three render the same
   * neutral word, because to the person reading a comment they are the same fact.
   */
  nameOf(zoneId: string, userId: string): string | null {
    return this._byZone().get(zoneId)?.get(userId)?.username ?? null;
  }

  /**
   * What that user is in that zone, or null.
   *
   * Null for the same three situations `nameOf` returns null for, and the caller draws
   * nothing rather than falling back to MEMBER: the fallback in `enums.ts` exists to
   * read an unrecognised value off the wire safely, and using it here would quietly
   * demote an owner for as long as the members request is in flight.
   *
   * The **zone** role, which is the only one the client can know for somebody else. A
   * per list role is not broadcast and there is no endpoint that answers it.
   */
  roleOf(zoneId: string, userId: string): ZoneRole | null {
    return this._byZone().get(zoneId)?.get(userId)?.role ?? null;
  }

  /** Every member of a zone this cache knows, for the share sheet's rows. */
  membersOf(zoneId: string): readonly Membership[] {
    return this._raw.get(zoneId) ?? [];
  }

  /**
   * Load a zone's members, once per session.
   *
   * Idempotent by design: every row in a comment sheet would otherwise ask, and the
   * answer is the same for all of them. A failure is swallowed and the zone stays
   * unasked, so a later visit retries rather than being permanently nameless.
   */
  async ensure(zoneId: string): Promise<void> {
    if (zoneId === '' || this._asked.has(zoneId)) {
      return;
    }

    this._asked.add(zoneId);

    try {
      const page = await this._members.listMembers(zoneId, { limit: 100 });
      this._absorb(zoneId, page.items);

      // Paged only when a group is genuinely large. The loop is bounded by the cursor
      // rather than by a count, and every page is folded into the same map.
      let cursor = page.nextCursor;
      while (cursor !== null) {
        const next = await this._members.listMembers(zoneId, {
          cursor,
          limit: 100,
        });
        this._absorb(zoneId, next.items);
        cursor = next.nextCursor;
      }
    } catch {
      // Deliberately quiet. Nobody is shown an error panel because a name could not be
      // resolved: the sheet is still readable, and the fallback word is the design.
      this._asked.delete(zoneId);
    }
  }

  /** Test seam: seed the cache without a request. */
  prime(zoneId: string, members: readonly Membership[]): void {
    this._asked.add(zoneId);
    this._absorb(zoneId, members);
  }

  private readonly _raw = new Map<string, readonly Membership[]>();

  /**
   * Keep a cached zone current from the events that carry a membership.
   *
   * Nothing is ever **removed**, kick and ban included. The class comment's rule
   * stands: a comment outlives its author's membership, and dropping the name would
   * take it off everything they ever wrote. So a departure refreshes the row like any
   * other event and the name survives it.
   *
   * `member.rejected` carries no membership and is not handled here, which the event
   * union enforces rather than leaves to a comment.
   */
  private _apply(event: RealtimeEvent): void {
    switch (event.type) {
      case 'member.joined':
      case 'member.approved':
      case 'member.kicked':
      case 'member.banned':
      case 'member.roleChanged':
      case 'member.usernameChanged': {
        const { zoneId } = event.membership;
        if (this._asked.has(zoneId)) {
          this._absorb(zoneId, [event.membership]);
        }
        return;
      }
      default:
        return;
    }
  }

  /**
   * Fold members into a zone's cache, **replacing** an existing row rather than
   * appending to it.
   *
   * Replacing matters now that this is fed by events as well as by pages: an append
   * would give the share sheet two rows for one person the moment somebody was renamed
   * or promoted, and a rename would leave the old name in `membersOf` beside the new
   * one. It also makes a re-delivered event free.
   */
  private _absorb(zoneId: string, members: readonly Membership[]): void {
    const byId = new Map(
      (this._raw.get(zoneId) ?? []).map((member) => [member.id, member])
    );
    for (const member of members) {
      byId.set(member.id, member);
    }
    this._raw.set(zoneId, [...byId.values()]);

    this._byZone.update((current) => {
      const known = new Map(current.get(zoneId) ?? []);
      for (const member of members) {
        // A nameless row is not indexed, which is the rule `nameOf` has always applied
        // and it now governs the role too. That is the right way round: the role is
        // drawn next to the name, so a role with no name to sit beside is not a thing
        // any surface can render.
        if (member.username !== '') {
          known.set(member.userId, member);
        }
      }

      return new Map(current).set(zoneId, known);
    });
  }
}
