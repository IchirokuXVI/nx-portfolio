import { InjectionToken } from '@angular/core';

/**
 * When a live token renews itself, and when an unattended one is warned about
 * (plan 0003, sections 1 and 3).
 *
 * Both numbers are **fractions of the token's own lifetime**, never durations.
 * Plan 0071 makes the admin token's TTL configurable, so a warning fixed at
 * three minutes is nonsense against a development token that lasts a day and
 * arrives after expiry against one that lasts two minutes. A fraction is right
 * at every TTL, which is why the plan states the warning as "one fifth of the
 * token's lifetime remains" rather than as a clock time.
 *
 * There is deliberately **no idle timeout** among these. Idle is not a fourth
 * number: an operator is active when they have interacted since the token now
 * held was issued, which {@link decideKeepalive} reads straight off the session.
 * A separate threshold would be a second definition of the same word, free to
 * disagree with the first.
 */
export interface SessionPolicy {
  /**
   * The remaining fraction at which an active, visible tab renews. One half of
   * a fifteen minute token is seven and a half minutes in, leaving a full half
   * lifetime for the renewal to fail and be retried before anything is lost.
   */
  readonly renewFraction: number;
  /**
   * The remaining fraction at which an idle session is warned. Must be smaller
   * than {@link renewFraction}, and is clamped to it if it is not, so a
   * misconfiguration produces a warning at the renewal point rather than a
   * session that warns before it has ever tried to renew.
   */
  readonly warnFraction: number;
  /**
   * How long to wait before trying again after a renewal that failed for a
   * reason other than a dead token.
   *
   * A renewal is the one request this app makes that nobody asked for, and the
   * usual reason it fails is a network that blinked. Retrying rather than
   * giving up is what keeps a blink from costing an operator their session; the
   * wait is what keeps a gateway that is down from being asked once a
   * millisecond until the token expires anyway.
   */
  readonly renewRetryMs: number;
}

/** One half, one fifth, and half a minute. The plan's numbers. */
export const DEFAULT_SESSION_POLICY: SessionPolicy = {
  renewFraction: 0.5,
  warnFraction: 0.2,
  renewRetryMs: 30_000,
};

/**
 * The policy, as one overridable value.
 *
 * A token with a default rather than a constant three services import, so a
 * spec can drive the whole keepalive with a two second lifetime and the app can
 * change its mind in one line without any library learning a new import.
 */
export const ADMIN_SESSION_POLICY = new InjectionToken<SessionPolicy>(
  'ADMIN_SESSION_POLICY',
  { factory: () => DEFAULT_SESSION_POLICY }
);

/** Everything the decision reads. All instants are epoch milliseconds. */
export interface KeepaliveInput {
  readonly now: number;
  /** When this app took the token now held. The start of its lifetime. */
  readonly receivedAt: number;
  /** When the server says the token stops being accepted. */
  readonly expiresAt: number;
  /** The last real interaction: pointer, key, touch or scroll. */
  readonly lastActivityAt: number;
  /** Whether the document is visible. A hidden tab never renews. */
  readonly visible: boolean;
  readonly policy: SessionPolicy;
}

/**
 * What to do about the held token, right now.
 *
 * `wait` and `warn` both name the instant to ask again at, so the caller arms
 * exactly one timer and never polls. `warn` is separate from `wait` only
 * because it also has something to show.
 */
export type KeepaliveDecision =
  /** Renew now. The token is live, the operator is here, the tab is visible. */
  | { readonly kind: 'renew' }
  /** Show the warning, and decide again at `at`. */
  | { readonly kind: 'warn'; readonly at: number }
  /** Nothing to do until `at`. */
  | { readonly kind: 'wait'; readonly at: number }
  /** The token is over. Re-authenticate in place. */
  | { readonly kind: 'expire' };

/**
 * The whole session rule, as one pure function (plan 0003, sections 1 to 3).
 *
 * Pure on purpose: every interesting case here is a moment in time, and a
 * function of instants can be asserted at any of them without a timer, a fake
 * clock or a rendered component. The service around it owns one `setTimeout`
 * and a handful of listeners, and holds no rule of its own.
 *
 * **Active means the operator has interacted since this token was issued.** That
 * is the whole definition, and it makes the two halves of the plan fall out of
 * one comparison: somebody working touches something every few seconds, so every
 * renewal point finds them active and the session never ends; somebody who
 * walked away has not touched anything since the last renewal, so the next
 * renewal point declines, the warning follows at the configured fraction, and
 * expiry follows that.
 *
 * A fresh sign in is deliberately **not** active: the click that submitted the
 * form happened before the token it produced. So a tab signed in and abandoned
 * warns and expires on the first lifetime rather than the second, which is the
 * behaviour the whole design is for.
 */
export function decideKeepalive(input: KeepaliveInput): KeepaliveDecision {
  const { now, receivedAt, expiresAt, lastActivityAt, visible, policy } = input;

  // Checked first and against nothing else. An expired token is expired whether
  // or not the tab is visible, whether or not anybody is typing, and whether or
  // not the fractions make sense.
  if (now >= expiresAt) {
    return { kind: 'expire' };
  }

  const lifetime = Math.max(expiresAt - receivedAt, 0);
  const renew = fraction(policy.renewFraction);
  // Clamped to the renewal fraction rather than trusted: a warning that fires
  // before the first renewal attempt would tell an active operator their session
  // is ending while the app is about to renew it silently.
  const warn = Math.min(fraction(policy.warnFraction), renew);

  const renewAt = expiresAt - lifetime * renew;
  const warnAt = expiresAt - lifetime * warn;

  const active = lastActivityAt > receivedAt;

  if (now >= renewAt && active && visible) {
    return { kind: 'renew' };
  }

  // Reached only by an idle session, or by a hidden tab that must not hold a
  // session open. Either way the token is allowed to run down from here, and the
  // next decision is at expiry: activity or a return to the foreground re-enters
  // this function early and renews.
  if (now >= warnAt) {
    return { kind: 'warn', at: expiresAt };
  }

  return { kind: 'wait', at: now >= renewAt ? warnAt : renewAt };
}

/** A fraction of a lifetime, or the nearest thing to one. */
function fraction(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
}
