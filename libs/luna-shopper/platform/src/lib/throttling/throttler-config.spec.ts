import {
  createThrottlerOptions,
  readThrottleMultiplier,
  scaleThrottleLimit,
  THROTTLE_LIMITS,
  THROTTLE_MULTIPLIER_VARIABLE,
} from './throttler-config';

/**
 * The multiplier a development stack raises its limits with.
 *
 * The value is read once at import time, because the per route limits are
 * arguments to `@Throttle()` and that runs while a controller file is imported.
 * So the reading is tested through {@link readThrottleMultiplier} on its own, and
 * the wiring is tested by importing the module again with the variable set,
 * which is the only way to observe the read.
 */
describe('the throttle multiplier', () => {
  it('is 1 when the variable is absent, blank or not a number', () => {
    expect(readThrottleMultiplier(undefined)).toBe(1);
    expect(readThrottleMultiplier('')).toBe(1);
    expect(readThrottleMultiplier('   ')).toBe(1);
    expect(readThrottleMultiplier('twenty')).toBe(1);
  });

  /**
   * Tightening is not what the variable is for, and a stack that limited itself
   * to nothing by a typed minus sign would be very hard to read from the outside.
   */
  it('never tightens a limit', () => {
    expect(readThrottleMultiplier('0')).toBe(1);
    expect(readThrottleMultiplier('0.5')).toBe(1);
    expect(readThrottleMultiplier('-20')).toBe(1);
  });

  it('reads a raise', () => {
    expect(readThrottleMultiplier('20')).toBe(20);
    expect(readThrottleMultiplier('2.5')).toBe(2.5);
  });

  /** A fraction is not a count, and a limit of zero refuses every request. */
  it('scales to a whole number of at least one', () => {
    expect(scaleThrottleLimit(5)).toBe(5);
    expect(scaleThrottleLimit(0)).toBe(1);
  });

  /**
   * The shipped numbers, which are what both clusters run: nothing sets the
   * variable there, so a change to these is a change to production.
   */
  it('leaves the limits alone with the variable unset', () => {
    expect(process.env[THROTTLE_MULTIPLIER_VARIABLE]).toBeUndefined();
    expect(THROTTLE_LIMITS.login['default'].limit).toBe(5);
    expect(THROTTLE_LIMITS.passwordReset['default'].limit).toBe(1);
    expect(createThrottlerOptions()).toEqual({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
    });
  });

  it('raises every limit at once when it is set', () => {
    jest.resetModules();
    process.env[THROTTLE_MULTIPLIER_VARIABLE] = '20';
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const raised =
        require('./throttler-config') as typeof import('./throttler-config');
      expect(raised.THROTTLE_LIMITS.login['default'].limit).toBe(100);
      expect(raised.THROTTLE_LIMITS.passwordReset['default'].limit).toBe(20);
      expect(raised.createThrottlerOptions()).toEqual({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 2400 }],
      });
      // The window is untouched, so a route that reports its own wait from the
      // bucket keeps reporting the same wait.
      expect(raised.THROTTLE_LIMITS.login['default'].ttl).toBe(60_000);
    } finally {
      delete process.env[THROTTLE_MULTIPLIER_VARIABLE];
      jest.resetModules();
    }
  });
});
