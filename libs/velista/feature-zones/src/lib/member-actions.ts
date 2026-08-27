import type {
  MemberAction,
  Membership,
  ZoneRole,
} from '@portfolio/velista/models';

/**
 * What this caller may do to this member, taken from core rather than assumed.
 *
 * Every line below is read from `zone-authz.service.ts` and `membership.service.ts`
 * (plan 0010, section 5.4). Three of them are more restrictive than a designer would
 * guess, and each one changes what is on screen:
 *
 * - **An admin cannot promote anybody.** `setRole` is owner only, so an admin's row
 *   menu has remove and ban in it and no role control at all.
 * - **The owner cannot be removed, banned or renamed by an admin.** So the owner's row
 *   has no menu when anybody else is looking at it. Not a disabled menu: an absent one,
 *   because a disabled control implies a permission that is merely unavailable today.
 * - **A member cannot leave.** There is no route for it, so nothing here offers one.
 *   Section 5.8 records that as the gap it is.
 *
 * A **pure function** for `selectHomeState`'s reason: it is the part of these screens
 * most worth testing exhaustively, and a pure function is the cheapest thing in the
 * world to test. It is also the whole of rule G2's drawing half in one place, so the
 * rule can be read rather than reconstructed from templates.
 *
 * **It decides what is drawn and never what is allowed.** `ZoneAuthzService` resolves
 * the caller's membership on every request, so a demoted admin holding a valid token is
 * refused by the server whatever this returned. Hiding a control is a courtesy to the
 * person, not a security boundary, and any comment suggesting otherwise is wrong.
 */
export function memberActionsFor(input: {
  /** The caller's role in this zone, from `myRole` and never from a count (rule G2). */
  readonly myRole: ZoneRole;
  /** The caller's user id, so their own row can be recognised. */
  readonly myUserId: string | null;
  readonly member: Pick<Membership, 'userId' | 'role'>;
}): readonly MemberAction[] {
  const { myRole, myUserId, member } = input;
  const isSelf = myUserId !== null && member.userId === myUserId;

  // Your own row, whoever you are. Renaming yourself is the one governance route open
  // to an ordinary member, and it is open to a PENDING one too. Nothing else belongs
  // here: there is no way to leave a group, so an exit on your own row would be a
  // control that cannot work.
  if (isSelf) {
    return ['rename'];
  }

  // A plain member sees no menu on anybody else's row. Every remaining action is staff
  // only, and drawing them disabled would advertise powers they do not have.
  if (myRole === 'MEMBER') {
    return [];
  }

  // The owner's row, seen by an admin. Not one action on this list is permitted
  // against an owner: they cannot be kicked, banned, renamed by an admin, or have
  // their role changed. An empty list is what makes the menu absent rather than empty.
  if (member.role === 'OWNER') {
    return [];
  }

  const actions: MemberAction[] = [];

  if (myRole === 'OWNER') {
    // Owner only, and `SetRoleDto` accepts ADMIN and MEMBER alone, so promoting to
    // owner is impossible through this route and the UI offers the transfer instead.
    actions.push(member.role === 'ADMIN' ? 'makeMember' : 'makeAdmin');
    actions.push('transfer');
  }

  // An admin may rename an ordinary member and another admin, just not the owner,
  // which the branch above already returned for.
  actions.push('rename', 'remove', 'ban');

  return actions;
}

/**
 * Whether this caller may see who is waiting to join, and therefore whether the
 * members screen asks for the pending memberships at all.
 *
 * From `myRole`, per rule G2. Asking for any `statuses` other than APPROVED as an
 * ordinary member is a `forbidden` rather than an empty page, so this is what keeps the
 * screen from firing a request in order to be refused.
 */
export function canSeePendingRequests(myRole: ZoneRole): boolean {
  return myRole === 'OWNER' || myRole === 'ADMIN';
}
