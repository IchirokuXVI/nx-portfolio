import {
  PRICE_REFRESH_REASON_DETAIL,
  PriceNotRefreshableException,
} from './domain-exception';
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

  it('refuses a price that cannot be refreshed with 409, and publishes its reason (plan 0216)', () => {
    expect(ERROR_STATUS[ERROR_CODES.PRICE_NOT_REFRESHABLE]).toBe(409);
    const refused = new PriceNotRefreshableException('off', {
      details: { [PRICE_REFRESH_REASON_DETAIL]: 'SOURCE_OFF' },
    });
    expect(refused.code).toBe('price_not_refreshable');
    expect(refused.exposesDetails).toBe(true);
    expect(refused.details).toEqual({ reason: 'SOURCE_OFF' });
  });
});
