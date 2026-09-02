import { GatewayError, NetworkError } from '@portfolio/velista/data-access';
import { ERROR_CODES, type ErrorCode } from '@portfolio/velista/models';
import {
  basketErrorKey,
  correlationIdOf,
  type BasketOperation,
} from './basket-error-copy';

/**
 * Plan 0052, section 7.2: the basket says what actually went wrong.
 *
 * In the shape of `list-error-copy.spec.ts`, and for its reason. The gateway gives
 * every code one message, so the server's `message` reads identically for every 403 in
 * the product; the client keys its own copy on **code plus operation**, and this is the
 * assertion that the pairing is actually made rather than a `switch` that falls through
 * to the generic sentence for everything.
 */
function gateway(
  code: ErrorCode,
  status = 400,
  correlationId = 'ref-1'
): GatewayError {
  return new GatewayError({ code, status, correlationId });
}

/** Every operation, so the exhaustiveness test cannot go stale by omission. */
const OPERATIONS: readonly BasketOperation[] = [
  'basket.read',
  'basket.settle',
  'basket.reopen',
  'basket.pick',
  'basket.share',
  'basket.people',
  'basket.outstanding',
  'basket.origins',
  'basket.bind',
];

describe('basketErrorKey', () => {
  describe('settling a line that is already finished', () => {
    it('says so rather than "that did not save"', () => {
      // The sharpest of the ten reports. Two people work one list in a shop, so
      // somebody else finishing a line between the sheet opening and the tap landing
      // is the ordinary case, and it used to read as an unexplained failure.
      expect(basketErrorKey(gateway('conflict', 409), 'basket.settle')).toBe(
        'basket.error.alreadyFinished'
      );
    });

    it('says the same thing against a backend before luna 0054', () => {
      // Core raised `ValidationException('This line is already finished')`, which is
      // the same `validation_failed` as a malformed quantity. Luna 0054 section 4
      // makes it a conflict; until it ships this row is what the person reads, and
      // after it ships this row is what an older deployment still reads.
      expect(
        basketErrorKey(gateway('validation_failed', 400), 'basket.settle')
      ).toBe('basket.error.alreadyFinished');
    });

    it('does not claim a line is finished on any other act', () => {
      // The sentence is about a settle. A conflict on a reopen means something else
      // entirely, and borrowing the copy would be a confident wrong answer.
      expect(basketErrorKey(gateway('conflict', 409), 'basket.reopen')).toBe(
        'basket.error.failed'
      );
    });
  });

  describe('forbidden, which means several things here', () => {
    it('tells somebody settling that their access to a list changed', () => {
      expect(basketErrorKey(gateway('forbidden', 403), 'basket.settle')).toBe(
        'basket.error.accessChanged'
      );
      expect(basketErrorKey(gateway('forbidden', 403), 'basket.reopen')).toBe(
        'basket.error.accessChanged'
      );
    });

    it('tells somebody sharing that only the owner may', () => {
      // A different sentence for the same code, which is the whole reason the
      // operation is half of the key.
      expect(basketErrorKey(gateway('forbidden', 403), 'basket.share')).toBe(
        'basket.error.ownerOnly'
      );
      expect(basketErrorKey(gateway('forbidden', 403), 'basket.people')).toBe(
        'basket.error.ownerOnly'
      );
    });
  });

  describe('the rows that do not care which act it was', () => {
    it('says the list is gone, whatever was being attempted', () => {
      for (const operation of OPERATIONS) {
        expect(basketErrorKey(gateway('not_found', 404), operation)).toBe(
          'basket.error.gone'
        );
      }
    });

    it('asks somebody tapping through an aisle to slow down', () => {
      for (const operation of OPERATIONS) {
        expect(basketErrorKey(gateway('rate_limited', 429), operation)).toBe(
          'basket.error.tooFast'
        );
      }
    });
  });

  describe('everything else', () => {
    it('gives the generic sentence to a failure that never reached the gateway', () => {
      expect(
        basketErrorKey(
          new NetworkError('ref-net', 'basket.settle'),
          'basket.settle'
        )
      ).toBe('basket.error.failed');
      expect(basketErrorKey(null, 'basket.read')).toBe('basket.error.failed');
    });

    it('gives it to a 401 too, because the screen has already said better', () => {
      // `unauthorized` deliberately has no row: `BasketStore._fail` turns it into the
      // `revoked` or `needsJoin` state, which is a whole screen rather than a
      // sentence. Reaching a row here would draw copy over a better answer.
      expect(
        basketErrorKey(gateway('unauthorized', 401), 'basket.settle')
      ).toBe('basket.error.failed');
    });

    it('answers every operation for every code, and never with nothing', () => {
      // The exhaustiveness the plan asks for: a table with a hole in it is a screen
      // that renders an empty paragraph where a sentence belongs.
      for (const code of ERROR_CODES) {
        for (const operation of OPERATIONS) {
          const key = basketErrorKey(gateway(code), operation);
          expect(typeof key).toBe('string');
          expect(key).not.toBe('');
        }
      }
    });
  });
});

describe('correlationIdOf', () => {
  it('hands back the reference a gateway failure carries', () => {
    expect(correlationIdOf(gateway('internal', 500, 'ref-9'))).toBe('ref-9');
  });

  it('has nothing to give for a failure that never reached the gateway', () => {
    expect(
      correlationIdOf(new NetworkError('ref-net', 'basket.settle'))
    ).toBeNull();
  });
});

/**
 * The codes velista `0054`, `0055` and `0056` made readable (velista `0054`).
 *
 * All three arrived before as something else: two as a plain `conflict` and one as a
 * `validation_failed`, so the screen said "somebody already finished this line" over
 * a line nobody had finished, and "that did not save" over a basket whose trip was
 * over. The codes exist on the backend and were simply missing from this app's hand
 * synced list, which is why these rows are as much about `ERROR_CODES` as about copy.
 */
describe('basketErrorKey: the three codes that used to read as a conflict', () => {
  it('names the number when somebody else moved the line', () => {
    // Every operation, deliberately: it means exactly the same thing to somebody
    // dragging a row's number and to somebody typing a household's share. The store
    // has already refetched by the time this is read, so the count the screen
    // interpolates is the number as it now stands.
    for (const operation of OPERATIONS) {
      expect(basketErrorKey(gateway('stale_quantity', 409), operation)).toBe(
        'basket.error.staleLine'
      );
    }
  });

  it('names the floor when a contribution goes under what was bought', () => {
    expect(
      basketErrorKey(gateway('below_settled', 409), 'basket.origins')
    ).toBe('basket.error.belowSettled');
  });

  it('says the trip is over rather than that the save failed', () => {
    // Distinct from `alreadyFinished`, which is about one line. This is the basket.
    expect(
      basketErrorKey(
        gateway('generated_list_finished', 409),
        'basket.outstanding'
      )
    ).toBe('basket.error.basketFinished');
    expect(
      basketErrorKey(gateway('generated_list_finished', 409), 'basket.bind')
    ).toBe('basket.error.basketFinished');
  });
});

describe('basketErrorKey: sending a line to a list', () => {
  it('tells a refused kind of line apart from one already sent', () => {
    // Two refusals, two sentences. "Only a line added here can be sent" is about what
    // the line is; "this has already been sent" is about what has happened to it, and
    // one message for both would be no sentence at all.
    expect(
      basketErrorKey(gateway('validation_failed', 400), 'basket.bind')
    ).toBe('basket.error.notSendable');
    expect(basketErrorKey(gateway('conflict', 409), 'basket.bind')).toBe(
      'basket.error.alreadySent'
    );
  });

  it('does not borrow either sentence for any other act', () => {
    // Both are about the bind. A conflict on the units sheet means something else,
    // and borrowing the copy would be a confident wrong answer.
    expect(basketErrorKey(gateway('conflict', 409), 'basket.origins')).toBe(
      'basket.error.failed'
    );
    expect(
      basketErrorKey(gateway('validation_failed', 400), 'basket.origins')
    ).toBe('basket.error.failed');
  });

  it('says the outstanding write met a line somebody else finished', () => {
    // The row's own number is a settle by another name when it goes down, so a
    // conflict on it reads exactly as a conflict on the sheet's button does.
    expect(basketErrorKey(gateway('conflict', 409), 'basket.outstanding')).toBe(
      'basket.error.alreadyFinished'
    );
  });
});

describe('basketErrorKey: access that moved on the three zone surfaces', () => {
  it('says what changed rather than taking the basket away', () => {
    // The origins, targets and bind routes refuse a guest and a reader who has lost
    // `WRITE` outright rather than answering an empty sheet, so a 403 on one is the
    // same fact the settle already reports.
    for (const operation of [
      'basket.outstanding',
      'basket.origins',
      'basket.bind',
    ] as const) {
      expect(basketErrorKey(gateway('forbidden', 403), operation)).toBe(
        'basket.error.accessChanged'
      );
    }
  });
});
