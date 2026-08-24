import { resolveErrorMessage } from './error-catalog';
import { ERROR_CODES } from './error-codes';

describe('resolveErrorMessage', () => {
  it('returns the message in the requested locale', () => {
    expect(resolveErrorMessage(ERROR_CODES.NOT_FOUND, 'es')).toBe(
      'No se encontró el recurso solicitado.'
    );
    expect(resolveErrorMessage(ERROR_CODES.NOT_FOUND, 'en')).toBe(
      'The requested resource was not found.'
    );
  });

  it('defaults to English when no locale is given', () => {
    expect(resolveErrorMessage(ERROR_CODES.FORBIDDEN)).toBe(
      'You do not have permission to do that.'
    );
  });

  it('interpolates message arguments', () => {
    expect(
      resolveErrorMessage(ERROR_CODES.CONFLICT, 'en', { name: 'zone' })
    ).toContain('conflicts');
  });
});
