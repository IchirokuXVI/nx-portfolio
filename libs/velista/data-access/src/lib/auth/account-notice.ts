import { Injectable, signal } from '@angular/core';

/**
 * What just happened to the caller's account, for the dashboard to say once.
 *
 * Two things can happen and the dashboard renders a different thing for each: a fresh
 * registration gets the confirm-your-email nudge, and an upgrade gets the one line
 * saying the account is secured and naming the address. Both are drawn in the second
 * frame of their artboard (plan 0009, section 2).
 */
export type AccountNoticeKind = 'registered' | 'upgraded';

export interface AccountNoticeState {
  readonly kind: AccountNoticeKind;
  /**
   * The address the person just typed.
   *
   * **This is the only place the app knows their email.** The token pair carries
   * `userId`, `kind` and `username` and no address, and `GET /v1/account/me` is out of
   * scope for this plan, so a nudge that names the address can only be shown on the
   * navigation that follows the form. That is also the right scope for it: it is news
   * about something that just happened, not a standing property of the session.
   */
  readonly email: string;
}

/**
 * A one-shot notice, held across exactly one navigation.
 *
 * The same shape and the same reasoning as `ZoneStore.lastEntry` (plan 0008): the
 * screen that causes the news is not the screen that reports it, and this is the one
 * thing above both that survives the navigation between them. Router state would also
 * survive, and would survive a **reload** through the history entry, which is exactly
 * wrong here: coming back to this URL tomorrow is not the moment to be told an account
 * was just secured.
 *
 * It deliberately holds no `Injectable({ providedIn: 'root' })`. It reaches for
 * nothing, so root would work, but every service this app's pages share is installed
 * on the app injector under rule D5, and one exception would be the one that is
 * resolved from the wrong place on the day somebody gives it a dependency.
 */
@Injectable()
export class AccountNotice {
  private readonly _notice = signal<AccountNoticeState | null>(null);

  /** The news, or null. Cleared by whoever renders it. */
  readonly notice = this._notice.asReadonly();

  /** Called by the register and upgrade screens, immediately before navigating. */
  set(kind: AccountNoticeKind, email: string): void {
    this._notice.set({ kind, email });
  }

  /** The dashboard has said it. It does not say it twice. */
  clear(): void {
    this._notice.set(null);
  }
}
