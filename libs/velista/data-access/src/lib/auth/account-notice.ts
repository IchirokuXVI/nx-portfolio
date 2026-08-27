import { Injectable, signal } from '@angular/core';

/**
 * What just happened to the caller's account, for the dashboard to say once.
 *
 * Two things can happen and the dashboard renders a different thing for each: a fresh
 * registration gets the confirm-your-email nudge, and an upgrade gets the one line
 * saying the account is secured and naming the address. Both are drawn in the second
 * frame of their artboard (plan 0009, section 2).
 */
export type AccountNoticeKind = 'registered' | 'upgraded' | 'deleted';

export interface AccountNoticeState {
  readonly kind: AccountNoticeKind;
  /**
   * The address the person just typed.
   *
   * The token pair carries `userId`, `kind` and `username` and no address, so a nudge
   * that names the address is shown on the navigation that follows the form. That is
   * also the right scope for it: it is news about something that just happened, not a
   * standing property of the session.
   *
   * Empty for `deleted`, which is the one notice with no address to name and the one
   * read by a different screen: the other two land on the dashboard, and somebody whose
   * account is gone lands on the front door (plan 0015, section 5.7).
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

  /**
   * Called by the delete sheet, immediately before navigating to the front door.
   *
   * Its own method rather than `set('deleted', '')`, so no call site has to pass an
   * empty string for a field that does not apply. Held here rather than in router
   * state, which would survive a reload: coming back to this URL tomorrow is not the
   * moment to be told an account was deleted.
   */
  setDeleted(): void {
    this._notice.set({ kind: 'deleted', email: '' });
  }

  /** The dashboard has said it. It does not say it twice. */
  clear(): void {
    this._notice.set(null);
  }
}
