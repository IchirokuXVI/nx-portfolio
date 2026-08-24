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
});
