import {
  LineApprovalStatus,
  ListPermission,
} from '@portfolio/luna-shopper/contracts';

/**
 * Who may settle, and who may change what a list asks for (plan 0131).
 *
 * Two surfaces write the same two numbers, and before this file they asked
 * different people for different permissions: the list page settled behind
 * `DECIDE` and the basket settled behind the owner's `WRITE`, while the list
 * page refused a `WRITE` holder the quantity of an approved line and the basket
 * allowed the same person the same move. A household cannot hold both rules, and
 * the basket that is always there (plan 0136) makes the looser one the default
 * screen.
 *
 * Both functions are pure, with no database and no service in them, so a spec
 * states the rule rather than mocking its way to it. Every caller is one of these
 * functions plus a read.
 */

/**
 * Whether a holder of these permissions can record a purchase or a shop that had
 * none.
 *
 * `WRITE`, which reverses plan 0036 section 1.2 for the settle and for nothing
 * else. That section asked for `DECIDE` because the list page was the only place
 * a purchase was recorded. Plan 0051 section 2 then let anybody holding `WRITE`
 * take a line into a basket and settle it from there, so a `WRITE` holder already
 * records purchases on every list they can write, from the other screen. What
 * `DECIDE` still protects is the thing it was named for: approving, rejecting,
 * and moving a number the group agreed to.
 */
export function canSettle(permissions: ReadonlySet<ListPermission>): boolean {
  return (
    permissions.has(ListPermission.WRITE) ||
    permissions.has(ListPermission.MANAGE)
  );
}

/**
 * Whether a holder of these permissions can change how many of a line the list
 * asks for.
 *
 * An approved quantity is what the group agreed to (plan 0076, section 4.1), so
 * moving it needs `DECIDE`. An unapproved line is still somebody's request, so
 * moving it needs the `WRITE` that made it. `MANAGE` reaches any line whatever
 * its approval.
 */
export function canChangeDemand(
  permissions: ReadonlySet<ListPermission>,
  approvalStatus: LineApprovalStatus
): boolean {
  if (permissions.has(ListPermission.MANAGE)) return true;
  if (approvalStatus === LineApprovalStatus.APPROVED) {
    return permissions.has(ListPermission.DECIDE);
  }
  return permissions.has(ListPermission.WRITE);
}
