import {
  DEFAULT_SESSION_POLICY,
  decideKeepalive,
  type KeepaliveInput,
  type SessionPolicy,
} from './session-keepalive';

/**
 * The session rule, asserted as arithmetic (plan 0003, sections 1 to 3).
 *
 * Every case here is a moment in the life of one token, and the function is pure,
 * so each of them is a call rather than a timer, a fake clock and a rendered
 * component. What is left for `session-lifecycle.spec.ts` is the machinery: the
 * timer, the listeners, and the requests.
 */

const MINUTE = 60_000;
const LIFETIME = 15 * MINUTE;

/** A token issued at zero, expiring at fifteen minutes. */
const RECEIVED_AT = 1_000_000;
const EXPIRES_AT = RECEIVED_AT + LIFETIME;

/** Half a lifetime in: seven and a half minutes. */
const RENEW_AT = EXPIRES_AT - LIFETIME * DEFAULT_SESSION_POLICY.renewFraction;
/** A fifth of a lifetime left: twelve minutes in, three to go. */
const WARN_AT = EXPIRES_AT - LIFETIME * DEFAULT_SESSION_POLICY.warnFraction;

function at(now: number, overrides: Partial<KeepaliveInput> = {}) {
  return decideKeepalive({
    now,
    receivedAt: RECEIVED_AT,
    expiresAt: EXPIRES_AT,
    // Before the token existed, so the session is idle unless a test says
    // otherwise. A fresh sign in really is this: the click that submitted the
    // form happened before the token it produced.
    lastActivityAt: RECEIVED_AT - MINUTE,
    visible: true,
    policy: DEFAULT_SESSION_POLICY,
    ...overrides,
  });
}

describe('decideKeepalive', () => {
  it('waits until the renewal point while the token is young', () => {
    expect(at(RECEIVED_AT)).toEqual({ kind: 'wait', at: RENEW_AT });
    expect(at(RENEW_AT - 1)).toEqual({ kind: 'wait', at: RENEW_AT });
  });

  describe('an operator who is working', () => {
    const active = { lastActivityAt: RECEIVED_AT + MINUTE };

    it('renews at the renewal point', () => {
      expect(at(RENEW_AT, active)).toEqual({ kind: 'renew' });
    });

    /**
     * Section 1's deliberate part. A session that only renewed on API traffic
     * would die while somebody filled in a long form, which is exactly when
     * losing it costs the most, so nothing here asks whether a request was made.
     */
    it('renews on interaction alone, with no request in sight', () => {
      expect(at(RENEW_AT + MINUTE, active)).toEqual({ kind: 'renew' });
    });

    /**
     * Section 2. A backgrounded tab must not hold a session open, and a phone in
     * a pocket is the case this exists for.
     */
    it('does not renew while the tab is hidden', () => {
      expect(at(RENEW_AT, { ...active, visible: false })).toEqual({
        kind: 'wait',
        at: WARN_AT,
      });
    });
  });

  describe('an operator who walked away', () => {
    it('lets an idle token run down to the warning', () => {
      expect(at(RENEW_AT)).toEqual({ kind: 'wait', at: WARN_AT });
    });

    it('warns at a fifth of the lifetime, and asks again at expiry', () => {
      expect(at(WARN_AT)).toEqual({ kind: 'warn', at: EXPIRES_AT });
      expect(at(EXPIRES_AT - 1)).toEqual({ kind: 'warn', at: EXPIRES_AT });
    });

    /** Section 3: anything they do while the warning is up renews the token. */
    it('renews instead of warning when they come back', () => {
      expect(at(WARN_AT, { lastActivityAt: WARN_AT })).toEqual({
        kind: 'renew',
      });
    });

    it('expires when the token is over', () => {
      expect(at(EXPIRES_AT)).toEqual({ kind: 'expire' });
      expect(at(EXPIRES_AT + MINUTE)).toEqual({ kind: 'expire' });
    });

    /**
     * Expiry is read off the clock and nothing else. A token that ran out while
     * the tab was in the background, or while somebody was typing into a form
     * whose renewal failed, is still a token that ran out.
     */
    it.each([
      ['a hidden tab', { visible: false }],
      ['an active operator', { lastActivityAt: EXPIRES_AT }],
    ])('expires despite %s', (_case, overrides) => {
      expect(at(EXPIRES_AT, overrides)).toEqual({ kind: 'expire' });
    });
  });

  /**
   * The warning is stated as a fraction rather than three minutes because plan
   * 0071 makes the TTL configurable, and a fixed three minutes arrives after
   * expiry on a two minute token and twenty three hours early on a day long one.
   */
  it('moves the warning with the lifetime rather than fixing it in minutes', () => {
    const short = decideKeepalive({
      now: RECEIVED_AT + 48,
      receivedAt: RECEIVED_AT,
      expiresAt: RECEIVED_AT + 60,
      lastActivityAt: 0,
      visible: true,
      policy: DEFAULT_SESSION_POLICY,
    });

    // A fifth of sixty milliseconds is twelve, so forty eight in is the warning.
    expect(short).toEqual({ kind: 'warn', at: RECEIVED_AT + 60 });
  });

  describe('a policy that does not make sense', () => {
    /**
     * A warning that fired before the first renewal attempt would tell an active
     * operator their session is ending while the app was about to renew it
     * silently.
     */
    it('never warns before the renewal point', () => {
      const upsideDown: SessionPolicy = {
        ...DEFAULT_SESSION_POLICY,
        renewFraction: 0.2,
        warnFraction: 0.9,
      };
      const renewAt = EXPIRES_AT - LIFETIME * 0.2;

      expect(at(renewAt - 1, { policy: upsideDown })).toEqual({
        kind: 'wait',
        at: renewAt,
      });
      expect(at(renewAt, { policy: upsideDown })).toEqual({
        kind: 'warn',
        at: EXPIRES_AT,
      });
    });

    it.each([
      ['a fraction above one', 4],
      ['a negative fraction', -1],
      ['a fraction that is not a number', Number.NaN],
    ])(
      'clamps %s rather than producing an instant outside the token',
      (_case, renewFraction) => {
        const decision = at(RECEIVED_AT + MINUTE, {
          policy: { ...DEFAULT_SESSION_POLICY, renewFraction },
        });

        if (decision.kind === 'wait' || decision.kind === 'warn') {
          expect(decision.at).toBeGreaterThanOrEqual(RECEIVED_AT);
          expect(decision.at).toBeLessThanOrEqual(EXPIRES_AT);
        }
      }
    );
  });

  /**
   * A restored session whose stored arrival could not be read is dated from now,
   * which makes the lifetime zero rather than negative. The decision still has
   * to be one of the four.
   */
  it('survives a session that appears to have no lifetime at all', () => {
    expect(
      at(RECEIVED_AT - MINUTE, { receivedAt: EXPIRES_AT + MINUTE })
    ).toEqual({ kind: 'wait', at: EXPIRES_AT });
  });
});
