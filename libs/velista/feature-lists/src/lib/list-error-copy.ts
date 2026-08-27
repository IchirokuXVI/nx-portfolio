import { GatewayError } from '@portfolio/velista/data-access';

/**
 * Which sentence a failure gets on this screen, keyed on the code **and the operation**.
 *
 * `zone-error-copy.ts` makes the argument at length and it holds here: the gateway's
 * catalog gives every code one message, so the server's `message` reads identically for
 * every 403 in the product and is unusable as copy. This is section 5.7's table.
 *
 * The operation matters more here than anywhere else in the app, because `forbidden`
 * means four different things on four different calls: a list that was never readable,
 * a caller who is a reader, a caller who was demoted out of staff, and access withdrawn
 * while the page was open. Two of those change what the page **is**, not just what it
 * says, which is why {@link listErrorEffect} exists beside the copy.
 */
export type ListOperation =
  /** Loading the lines. */
  | 'lines.read'
  /** Adding, editing, ticking off, deleting a line. */
  | 'lines.write'
  /** Approving or turning down. */
  | 'lines.decide'
  /** Rewriting the order. */
  | 'lines.reorder'
  /** Reading or adding a comment. */
  | 'comments'
  /** Renaming, sharing, deleting the list itself. */
  | 'list.manage';

/** The message any failure falls back to, including one with no code at all. */
const GENERIC = 'list.error.failed';

/**
 * The key to render, or `null` for a failure that must be **silent**.
 *
 * `null` is a designed outcome and there is exactly one: a `validation_failed` on a
 * reorder. It means the order named a line the server no longer has, which is somebody
 * deleting one mid drag. Two people editing one list is the normal case rather than the
 * exotic one, and the person who dragged has done nothing wrong, so the list rereads and
 * says nothing.
 */
export function listErrorKey(
  error: unknown,
  operation: ListOperation
): string | null {
  if (!(error instanceof GatewayError)) {
    // A `NetworkError`, or something that never reached the transport. The blocking
    // connection screen owns the first of those.
    return GENERIC;
  }

  switch (error.code) {
    case 'not_found':
      return 'list.error.notAvailable';

    case 'forbidden':
      switch (operation) {
        case 'lines.read':
          // A caller whose access was withdrawn between the group page and here. It is
          // deliberately the **same copy** as `not_found`, because the two are
          // indistinguishable to the person reading them and pretending otherwise would
          // be a distinction drawn for the developer's benefit.
          return 'list.error.notAvailable';
        case 'lines.decide':
          return 'list.error.roleChanged';
        case 'list.manage':
          return 'list.error.roleChanged';
        default:
          // A reader, or somebody whose access narrowed while the page was open. The
          // page switches to read only **in place** rather than being replaced, which
          // `listErrorEffect` reports separately.
          return 'list.error.readOnly';
      }

    case 'validation_failed':
      // Caught in the field before the request in every other case, so reaching here on
      // a write is the belt on top of the braces. On a reorder it is silent.
      return operation === 'lines.reorder' ? null : GENERIC;

    case 'rate_limited':
      // A run of quick adds hitting a bucket. The composer keeps its text, which is the
      // composer's business; this is only the sentence.
      return 'list.error.tooFast';

    default:
      // `unauthorized` is handled by the interceptor before it reaches a page, and
      // `internal` gets the generic sentence with the correlation id beside it.
      return GENERIC;
  }
}

/**
 * What a failure does to the page, beyond what it says.
 *
 * Separate from the copy because three of these change the page's **state** and the
 * sentence is only the visible half of that:
 *
 * - `read-only` is section 3.2 arriving late. The caller is a reader, the composer
 *   leaves, and this is the only way the client can learn that fact today: there is no
 *   `GET /v1/lists/:id/access` and `ListView` carries no role for the caller.
 * - `gone` is the list being deleted, or the caller's access to it withdrawn, which are
 *   indistinguishable and get the same treatment.
 * - `reread` is the silent reorder recovery.
 */
export type ListErrorEffect = 'none' | 'read-only' | 'gone' | 'reread';

export function listErrorEffect(
  error: unknown,
  operation: ListOperation
): ListErrorEffect {
  if (!(error instanceof GatewayError)) {
    return 'none';
  }

  if (error.code === 'validation_failed' && operation === 'lines.reorder') {
    return 'reread';
  }

  if (error.code === 'not_found' && operation === 'lines.read') {
    return 'gone';
  }

  if (error.code === 'forbidden') {
    switch (operation) {
      case 'lines.read':
        return 'gone';
      case 'lines.write':
      case 'comments':
        return 'read-only';
      default:
        // A demoted staff member keeps the page and loses the decision buttons, which
        // the abilities recompute from `myRole` once the zone refetches.
        return 'none';
    }
  }

  return 'none';
}

/** The support reference to show beside a generic failure, when there is one. */
export function correlationIdOf(error: unknown): string | null {
  return error instanceof GatewayError ? error.correlationId : null;
}
