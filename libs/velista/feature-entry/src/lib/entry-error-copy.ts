import { GatewayError } from '@portfolio/velista/data-access';

/**
 * Which sentence a failure gets, keyed on the error code **and the operation**.
 *
 * `ERROR_CATALOG` gives every code one message, so the server's `message` reads
 * identically for every 409 in the product and is unusable as copy: "already exists"
 * tells somebody joining a group nothing they can act on. Plan 0004 concluded the
 * client keys its own copy on code plus operation, and plan 0008 section 5.4 is that
 * table for these two calls.
 *
 * It is unambiguous because only one thing in core produces each code on each route.
 * That is what makes this a mapping rather than a guess, and it is also why it has to
 * be redone per operation rather than shared: the same 409 means "somebody took that
 * join code" on a create and "you already asked" on a join, and the two want opposite
 * things from the reader.
 */
export type EntryOperation = 'zones.create' | 'zones.join';

/** The message any failure falls back to, including one with no code at all. */
const GENERIC = 'entry.error.failed';

export function entryErrorKey(
  error: unknown,
  operation: EntryOperation
): string {
  if (!(error instanceof GatewayError)) {
    // A `NetworkError`, or something that never reached the transport. The blocking
    // connection screen owns the first of those, so all that is needed here is a
    // sentence that does not claim to know why.
    return GENERIC;
  }

  // Throttled at `THROTTLE_LIMITS.anonymousZone`, ten a minute, on both routes. The
  // copy says the same thing either way, so it is answered before the split.
  if (error.code === 'rate_limited') {
    return 'entry.error.tooMany';
  }

  if (operation === 'zones.create') {
    // The only specific one on a create, and it is not the person's fault: two zones
    // drew the same join code. So the copy says so, and the primary stays enabled.
    return error.code === 'conflict' ? 'entry.error.createClash' : GENERIC;
  }

  switch (error.code) {
    case 'not_found':
      // No ACTIVE zone has that code.
      return 'entry.error.noSuchZone';
    case 'conflict':
      // Already APPROVED here, or already PENDING. One message, because the person
      // cannot act differently on the two.
      return 'entry.error.alreadyAsked';
    case 'forbidden':
      // A BANNED membership exists. Deliberately does not say why.
      return 'entry.error.notAllowed';
    default:
      // `validation_failed` lands here, and is unreachable from the field: it
      // enforces the shape before anything is sent.
      return GENERIC;
  }
}
