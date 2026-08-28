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
});
