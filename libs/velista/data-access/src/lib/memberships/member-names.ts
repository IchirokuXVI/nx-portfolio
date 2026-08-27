import { inject, Injectable, signal } from '@angular/core';
import type { Membership } from '@portfolio/velista/models';
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
 */
@Injectable()
export class MemberNames {
  private readonly _members = inject<MembershipServiceI>(MEMBERSHIP_SERVICE);

  private readonly _byZone = signal<
    ReadonlyMap<string, ReadonlyMap<string, string>>
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
    return this._byZone().get(zoneId)?.get(userId) ?? null;
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

  private _absorb(zoneId: string, members: readonly Membership[]): void {
    this._raw.set(zoneId, [...(this._raw.get(zoneId) ?? []), ...members]);

    this._byZone.update((current) => {
      const names = new Map(current.get(zoneId) ?? []);
      for (const member of members) {
        if (member.username !== '') {
          names.set(member.userId, member.username);
        }
      }

      return new Map(current).set(zoneId, names);
    });
  }
}
