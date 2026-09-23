import { describeError } from './describe-error';
import { ConflictException } from './domain-exception';
import type { ProblemDetails } from './problem-details';

describe('describeError', () => {
  it('reads an Error by its message', () => {
    expect(describeError(new Error('socket closed'))).toEqual({
      message: 'socket closed',
    });
  });

  it('keeps the code of a domain exception', () => {
    expect(describeError(new ConflictException('EAN taken'))).toEqual({
      code: 'conflict',
      message: 'EAN taken',
    });
  });

  /** What a NATS client rejects with: the other service's envelope, not an Error. */
  it('reads a problem object by its detail, not as [object Object]', () => {
    const problem: ProblemDetails = {
      type: 'https://errors.luna-shopper-backend/conflict',
      title: 'conflict',
      status: 409,
      code: 'conflict',
      detail: 'Catalog already holds an item with EAN 8480000123456.',
      message: 'That conflicts with the current state.',
      correlationId: 'c1',
    };

    expect(describeError(problem)).toEqual({
      code: 'conflict',
      message: 'Catalog already holds an item with EAN 8480000123456.',
    });
  });

  it('falls back to the localized message of a problem with no detail', () => {
    expect(
      describeError({
        code: 'internal',
        message: 'Something went wrong on our side.',
        status: 500,
        correlationId: 'c1',
      })
    ).toEqual({
      code: 'internal',
      message: 'Something went wrong on our side.',
    });
  });

  it('reads a problem nested under error', () => {
    expect(
      describeError({ error: { code: 'not_found', detail: 'No such item.' } })
    ).toEqual({ code: 'not_found', message: 'No such item.' });
  });

  it('reads a string as itself', () => {
    expect(describeError('timed out')).toEqual({ message: 'timed out' });
  });

  it('answers a sentence for null and for an empty object', () => {
    expect(describeError(null)).toEqual({ message: 'Unknown error.' });
    expect(describeError(undefined)).toEqual({ message: 'Unknown error.' });
    expect(describeError({})).toEqual({ message: 'Unknown error.' });
  });
});
