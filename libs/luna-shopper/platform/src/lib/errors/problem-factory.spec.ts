import { LineUnitDiffersException } from './domain-exception';
import { ERROR_CODES } from './error-codes';
import { buildProblemDetails } from './problem-factory';

describe('buildProblemDetails', () => {
  it('maps a code to its status and always carries the correlation id', () => {
    const problem = buildProblemDetails({
      code: ERROR_CODES.NOT_FOUND,
      correlationId: 'abc-123',
      locale: 'en',
    });

    expect(problem.status).toBe(404);
    expect(problem.code).toBe('not_found');
    expect(problem.correlationId).toBe('abc-123');
    expect(problem.message).toBe('The requested resource was not found.');
    expect(problem.type).toContain('not_found');
  });

  it('localizes the message and includes validation errors when present', () => {
    const problem = buildProblemDetails({
      code: ERROR_CODES.VALIDATION_FAILED,
      correlationId: 'c',
      locale: 'es',
      errors: { name: ['name should not be empty'] },
    });

    expect(problem.status).toBe(400);
    expect(problem.message).toBe(
      'Algunos de los valores enviados no son válidos.'
    );
    expect(problem.errors).toEqual({ name: ['name should not be empty'] });
  });

  it('carries the wait on a rate limit, and omits the key everywhere else', () => {
    // The whole point of plan 0021, section 2: the number is in the body, because
    // `Retry-After` is not CORS safelisted and a browser client cannot read it.
    const limited = buildProblemDetails({
      code: ERROR_CODES.RATE_LIMITED,
      correlationId: 'c',
      retryAfterSeconds: 42,
    });

    expect(limited.status).toBe(429);
    expect(limited.retryAfterSeconds).toBe(42);

    const notFound = buildProblemDetails({
      code: ERROR_CODES.NOT_FOUND,
      correlationId: 'c',
    });

    // Absent rather than null: a client checks the key, not its value.
    expect('retryAfterSeconds' in notFound).toBe(false);
  });

  it('carries details when they are given, and omits the key otherwise', () => {
    // Plan 0112, section 2: a rename that collides names the other line, and the
    // client needs it to ask the question.
    const required = buildProblemDetails({
      code: ERROR_CODES.LINE_MERGE_REQUIRED,
      correlationId: 'c',
      messageArgs: { content: 'Milk' },
      details: { otherLineId: 'l2', otherContent: 'Milk', otherQuantity: 2 },
    });

    expect(required.status).toBe(409);
    expect(required.message).toBe(
      'This list already has a line called "Milk". Confirm to merge the two lines into one.'
    );
    expect(required.details).toEqual({
      otherLineId: 'l2',
      otherContent: 'Milk',
      otherQuantity: 2,
    });

    const notFound = buildProblemDetails({
      code: ERROR_CODES.NOT_FOUND,
      correlationId: 'c',
    });
    expect('details' in notFound).toBe(false);
  });

  it('exposes the details of line_unit_differs from an add, and none from a merge (plan 0260)', () => {
    const details = {
      line: {
        lineId: 'l1',
        content: 'Leche',
        unit: 'MILLILITER',
        quantity: 1500,
      },
      unit: 'UNIT',
      index: null,
    };
    const fromAdd = new LineUnitDiffersException('another unit', {
      details,
      messageArgs: { content: 'Leche' },
    });
    const fromMerge = new LineUnitDiffersException('another unit', {
      messageArgs: { content: 'Leche' },
    });

    expect(fromAdd.exposesDetails).toBe(true);
    const problem = buildProblemDetails({
      code: fromAdd.code,
      correlationId: 'c',
      messageArgs: fromAdd.messageArgs,
      details: fromAdd.exposesDetails ? fromAdd.details : undefined,
    });
    expect(problem.status).toBe(409);
    expect(problem.code).toBe('line_unit_differs');
    expect(problem.details).toEqual(details);

    const merged = buildProblemDetails({
      code: fromMerge.code,
      correlationId: 'c',
      messageArgs: fromMerge.messageArgs,
      details: fromMerge.exposesDetails ? fromMerge.details : undefined,
    });
    expect('details' in merged).toBe(false);
  });
});
