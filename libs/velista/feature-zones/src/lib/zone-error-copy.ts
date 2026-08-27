import { GatewayError } from '@portfolio/velista/data-access';

/**
 * Which sentence a failure gets, keyed on the error code **and the operation**.
 *
 * The gateway's `ERROR_CATALOG` gives every code one message, so the server's `message`
 * reads identically for every 403 in the product and is unusable as copy. Plan 0004
 * concluded the client keys its own copy on code plus operation; `0008` section 5.4 was
 * that table for the two ways in, and this is `0010` section 5.6 for these screens.
 *
 * It is a mapping rather than a guess because only one thing in core produces each code
 * on each route, which is also why it has to be redone per operation: a `forbidden` on
 * reading a group means a membership that is still pending, and the same code on a
 * governance write means the caller's role changed underneath the button they pressed.
 * The two want completely different things from the reader.
 */
export type ZoneOperation =
  /** Reading the group or its lists or its members. */
  | 'zone.read'
  /** Renaming, regenerating the code, deleting: anything staff do to the zone. */
  | 'zone.governance'
  /** Taking on an ownerless group. */
  | 'zone.claim'
  /** Answering somebody waiting to join. */
  | 'member.answer'
  /** Removing, banning, promoting, handing over. */
  | 'member.govern'
  /** Changing somebody's name inside the group. */
  | 'member.rename'
  /** Starting a list. */
  | 'list.create';

/** The message any failure falls back to, including one with no code at all. */
const GENERIC = 'zone.error.failed';

/**
 * The key to render, or `null` for a failure that must be **silent**.
 *
 * `null` is not "no key found". It is a designed outcome and there is exactly one:
 * approving somebody a second admin has already answered. Two admins looking at the
 * same queue is the normal case rather than the exotic one, and the one who tapped
 * half a second later has done nothing wrong. Showing them an error would be noise
 * about somebody else's success, so the row simply leaves, which is what the realtime
 * event was about to do anyway (section 5.6).
 */
export function zoneErrorKey(
  error: unknown,
  operation: ZoneOperation
): string | null {
  if (!(error instanceof GatewayError)) {
    // A `NetworkError`, or something that never reached the transport. The blocking
    // connection screen owns the first of those, so all that is needed here is a
    // sentence that does not claim to know why.
    return GENERIC;
  }

  switch (error.code) {
    case 'not_found':
      // Core answers not found rather than forbidden to somebody with no membership
      // at all, deliberately: a stranger must not be able to tell an existing group
      // from a missing one. So the two are indistinguishable here too, and the copy
      // covers both without claiming to know which it was.
      return 'zone.error.notAvailable';

    case 'forbidden':
      // On a read this is a PENDING membership, and it should never be reached:
      // section 3.3 decides that branch from `myStatus` before any request is made.
      // On a write it means the role changed underneath the caller, and the page
      // refetches behind this sentence.
      return operation === 'zone.read'
        ? 'zone.error.notAvailable'
        : 'zone.error.roleChanged';

    case 'validation_failed':
      // Somebody else answered this request first. See the doc comment.
      return operation === 'member.answer' ? null : GENERIC;

    case 'conflict':
      return operation === 'zone.claim' ? 'zone.error.alreadyClaimed' : GENERIC;

    case 'rate_limited':
      // The `usernameChange` bucket, which is five an hour rather than the usual
      // per minute allowance, so the wait is real and the copy does not promise a
      // number the server did not give (rule C3, plan 0009).
      return operation === 'member.rename'
        ? 'zone.error.tooManyRenames'
        : 'zone.error.failed';

    default:
      // `unauthorized` is handled by the interceptor before it reaches a page, and
      // `internal` gets the generic sentence with the correlation id beside it.
      return GENERIC;
  }
}

/**
 * Whether a failure means the page should refetch itself.
 *
 * True for exactly one case, and it is the one the copy above calls "Reloading": a
 * `forbidden` on a write says the caller's role is not what this page believed, so
 * every control drawn from `myRole` is now wrong and re-reading the zone is the only
 * way to put that right.
 */
export function shouldRefetch(
  error: unknown,
  operation: ZoneOperation
): boolean {
  return (
    error instanceof GatewayError &&
    error.code === 'forbidden' &&
    operation !== 'zone.read'
  );
}

/** The support reference to show beside a generic failure, when there is one. */
export function correlationIdOf(error: unknown): string | null {
  return error instanceof GatewayError ? error.correlationId : null;
}
