import { GatewayError } from '@portfolio/velista/data-access';

/** A sentence for the voice strip, by key, with whatever it interpolates. */
export interface VoiceFailureCopy {
  readonly messageKey: string;
  readonly messageArgs?: Record<string, string | number>;
}

/**
 * Which sentence a failed recording gets on the list.
 *
 * `list-error-copy.ts`'s argument, applied to the one control on this page that talks
 * to the assistant. The gateway's catalog gives every code one generic message, so the
 * server's own text is unusable as copy, and the page chooses from the code.
 *
 * **The organising question is not what went wrong. It is whether the list changed.**
 * A recording is one request that can write several lines, and the strip is the only
 * thing that tells somebody whether it did, so a sentence that guesses is a sentence
 * somebody acts on. There are three answers and each one has its own copy:
 *
 * - **Nothing was added, certainly.** The request never left, or the server refused it
 *   before a turn ran. "Try again" is safe advice here.
 * - **Nothing was added, and trying again will not help.** The deployment has no model
 *   provider. Saying "try again" to that is asking somebody to repeat themselves at a
 *   wall.
 * - **This client cannot tell.** The request reached the server and the server did not
 *   answer with a turn: a 500, a bad gateway, or a proxy giving up on a turn that is
 *   still running and will finish writing seconds later. The strip used to say
 *   "Nothing was added" here, which is the one claim it had no basis for, and somebody
 *   who believed it said the same sentence again and got two of everything.
 */
export function voiceFailureCopy(error: unknown): VoiceFailureCopy {
  if (!(error instanceof GatewayError)) {
    // A `NetworkError`, or something that never reached the transport at all. The
    // recording did not leave the phone, so nothing was added is a fact here.
    return { messageKey: 'list.add.voiceFailed' };
  }

  switch (error.code) {
    case 'rate_limited':
      // The bucket refused the request, so no turn ran. The number is the server's own
      // and is rendered as a countdown, so an absent one gets the sentence without a
      // clock rather than a clock counting down from a number this page invented
      // (plan 0009, rule C3).
      return error.retryAfterSeconds === undefined
        ? { messageKey: 'list.add.voiceBusyNoNumber' }
        : {
            messageKey: 'list.add.voiceBusy',
            messageArgs: { count: error.retryAfterSeconds },
          };

    case 'not_configured':
      // This deployment has no model provider, so the route answers 501 and will keep
      // answering 501 (backend plan 0026). The one failure that must not say "try
      // again": nobody did anything wrong and no amount of pressing send will help.
      return { messageKey: 'list.add.voiceUnavailable' };

    case 'validation_failed':
    case 'unauthorized':
    case 'forbidden':
    case 'not_found':
    case 'conflict':
      // Refused at the door: an unreadable recording, a list this caller may no longer
      // write to, a list that is gone. The turn never ran, so this is the same sentence
      // as a request that never left.
      return { messageKey: 'list.add.voiceFailed' };

    default:
      // `internal`, which is every 5xx and every proxy page this build could not read.
      // The assistant may have written lines already and may still be writing them.
      return { messageKey: 'list.add.voiceUnsure' };
  }
}
