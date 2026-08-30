import { ERROR_CODES, ERROR_STATUS, type ErrorCode } from './error-codes';

describe('ERROR_STATUS', () => {
  // The map is the gateway's only answer to "what status does this code get",
  // and Nest's HttpStatus does not name every status this project uses. A
  // missing member reads as `undefined` rather than failing loudly, so an entry
  // can look right and carry nothing. This asserts the values are real.
  it('gives every code a numeric status', () => {
    for (const code of Object.values(ERROR_CODES) as ErrorCode[]) {
      expect(typeof ERROR_STATUS[code]).toBe('number');
      expect(ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
    }
  });

  it('refuses a retired client with 426 Upgrade Required', () => {
    expect(ERROR_STATUS[ERROR_CODES.CLIENT_TOO_OLD]).toBe(426);
  });

  it('answers an unconfigured deployment with 501, not 503', () => {
    expect(ERROR_STATUS[ERROR_CODES.NOT_CONFIGURED]).toBe(501);
  });
});
