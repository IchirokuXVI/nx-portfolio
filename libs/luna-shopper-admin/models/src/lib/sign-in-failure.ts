/**
 * Why a sign in did not produce a session (plan 0002, section 2).
 *
 * The screen switches on this and nothing else. No component sees an HTTP
 * status, and no component sees a backend error code: those are wire details
 * that belong to `data-access`, and a page that reads them ends up with the
 * status number scattered through it.
 *
 * The set is deliberately small and every member reads differently on screen,
 * because collapsing them into "login failed" is the failure this list exists to
 * prevent: it makes the lockout invisible, and the lockout is the one an
 * operator most needs to understand.
 */
export type SignInFailureReason =
  /**
   * The username, the password, or both.
   *
   * **One reason for several server side outcomes, and that is correct.** An
   * unknown username, a wrong password and a disabled account all answer with
   * this, because plan 0071 answers all three with one 401 on purpose: telling
   * them apart confirms to whoever is guessing which usernames are real. So the
   * app cannot distinguish them, and must not appear to.
   */
  | 'invalid-credentials'
  /**
   * Too many attempts from here, too fast. Limits a *source*, so waiting clears
   * it and so does nothing else the operator can do.
   */
  | 'throttled'
  /**
   * The account itself is refusing attempts, after too many consecutive
   * failures. Limits an *account*, so a different network does not help; it
   * clears when the window passes or when somebody with the server clears it.
   */
  | 'locked-out'
  /**
   * The server answered, and the answer was that it cannot do this. A 501 from a
   * deployment with the development autologin misconfigured is the one that
   * happens in practice. Retrying will not help, and the copy has to say so.
   */
  | 'not-available'
  /**
   * Everything else: no response at all, a 500, a proxy's HTML error page, a
   * body that did not parse.
   *
   * The catch-all is a named member rather than an absent one, so the mapping is
   * total and a failure that was never anticipated still reaches the screen as a
   * sentence instead of as an empty error area.
   */
  | 'unknown';

/**
 * A refusal, with whatever the server said about how long it lasts.
 *
 * `retryAfterSeconds` is only ever present because the server named it. It is
 * never invented, never defaulted and never rendered as a countdown from a
 * number this app chose: telling an operator to wait sixty seconds when nobody
 * said sixty is worse than not saying, because it will be believed.
 */
export interface SignInFailure {
  readonly reason: SignInFailureReason;
  /** Whole seconds, when the server named a wait. Absent when it did not. */
  readonly retryAfterSeconds?: number;
}
