import type { GatewayError } from '@portfolio/luna-shopper-admin/data-access';

/**
 * A failure, as the sentence a screen shows.
 *
 * Code first and status second, the same order `toSignInFailure` uses and for
 * the same reason: the code is the contract, and the status is the fallback for
 * a body that did not reach this app intact, which is what a proxy answering
 * instead of the gateway looks like.
 *
 * The mapping is **total** over failures. An unanticipated one reaches the
 * operator as a sentence saying the server did not explain itself, rather than
 * as an empty screen or a blank banner.
 *
 * **No failure is `null`, and it is not the unknown one.** Every screen that
 * draws this key guards it on truthiness, so a string here for the state where
 * nothing went wrong put "That did not work" over four working screens: the
 * shops and sources queues, and the two queues behind `QueueFrame`. A caller
 * that has already established a failure and only lost its type says so with
 * `?? 'resource.error.unknown'`, which is one visible word at the call site
 * rather than a default nothing can opt out of.
 *
 * There is no case for `unauthorized`. A 401 never gets this far: the
 * interceptor turns it into a token renewal, an overlay and a retry (plan 0003,
 * section 6), so a screen that showed a message about it would be describing
 * something the operator has already been asked about.
 */
export function gatewayErrorKey(error: GatewayError | null): string | null {
  if (error === null) {
    return null;
  }

  switch (error.code) {
    case 'not_found':
      return 'resource.error.notFound';
    case 'forbidden':
      return 'resource.error.forbidden';
    case 'conflict':
      return 'resource.error.conflict';
    case 'validation_failed':
      return 'resource.error.validation';
    case 'postal_code_unknown':
      // A code that is not in the national centroid table, which means somebody
      // typed it wrong (backend plan 0097, section 6.1). It is named apart from
      // the generic validation sentence because it is the answer an operator
      // adding a city's worth of codes gets most often, and "that code does not
      // exist" is a typo they can fix while "the request was refused" is not.
      return 'resource.error.postalCodeUnknown';
    case 'run_in_progress':
      // A row the harvester is working on right now. A conflict, but the useful
      // half is which conflict: waiting for the run to finish is the whole of
      // what the operator has to do.
      return 'resource.error.runInProgress';
  }

  switch (error.status) {
    case 0:
      // No response at all: the request never arrived, or the browser refused
      // it. Naming it separately is worth a key, because it is the one failure
      // an operator can usually fix themselves.
      return 'resource.error.unreachable';
    case 403:
      return 'resource.error.forbidden';
    case 404:
      return 'resource.error.notFound';
    case 409:
      return 'resource.error.conflict';
    default:
      return 'resource.error.unknown';
  }
}
