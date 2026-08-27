import { HttpStatus } from '@nestjs/common';
import {
  ERROR_CODES,
  ERROR_STATUS,
  NotConfiguredException,
} from '@portfolio/luna-shopper/platform';
import { GoogleConfiguredGuard } from './google-auth.guard';

/**
 * The guard that turns an inert route into an honest answer (plan 0026).
 *
 * With Google unset the strategy provider resolves to `null`, so passport has
 * nothing registered under `'google'` and `AuthGuard('google')` throws
 * `Unknown authentication strategy`, which the global filter renders as a 500
 * with the `internal` code. A caller could not tell "this deployment has no
 * Google" from "the gateway is broken".
 */
describe('GoogleConfiguredGuard', () => {
  function guardWith(enabled: boolean) {
    return new GoogleConfiguredGuard({
      getOrThrow: () => ({ google: { enabled } }),
    } as never);
  }

  it('lets the request through when Google is configured', () => {
    expect(guardWith(true).canActivate()).toBe(true);
  });

  it('throws not_configured when Google is unset', () => {
    expect(() => guardWith(false).canActivate()).toThrow(
      NotConfiguredException
    );
  });

  it('carries the code that renders as 501', () => {
    // 501, not 503 or 404: 503 says "try again later", which is wrong for a
    // deployment that will never have Google; 404 says the route does not
    // exist, which contradicts keeping it in the published document.
    let thrown: unknown;
    try {
      guardWith(false).canActivate();
    } catch (error) {
      thrown = error;
    }

    expect((thrown as NotConfiguredException).code).toBe(
      ERROR_CODES.NOT_CONFIGURED
    );
    expect(ERROR_STATUS[ERROR_CODES.NOT_CONFIGURED]).toBe(
      HttpStatus.NOT_IMPLEMENTED
    );
  });
});
