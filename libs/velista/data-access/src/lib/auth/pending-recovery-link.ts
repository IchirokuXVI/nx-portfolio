import { Injectable, signal } from '@angular/core';

/**
 * A sign in link held while the person decides whether to leave the account on this
 * phone (velista `0148`, the owner's requirement of 2026-10-14).
 *
 * When a sign in link meets another account, the reset page goes home and the sheet
 * there asks. The token waits here, in memory, and **never in the sheet's URL**: a URL
 * is history, a referrer and a screenshot, and the token is a key to an account until
 * it is spent. Nothing is sent about it until the person presses the sheet's button.
 * If they do not, it is dropped with the document and the link in the mail still works.
 *
 * Held on the app injector like every service the pages share (rule D5), because the
 * page that receives the token and the sheet that spends it are two different screens.
 */
@Injectable()
export class PendingRecoveryLink {
  private readonly _token = signal<string | null>(null);

  /** The token waiting on a decision, or null. */
  readonly token = this._token.asReadonly();

  hold(token: string): void {
    this._token.set(token);
  }

  /** The person decided, or walked away. Either way it is not held any longer. */
  clear(): void {
    this._token.set(null);
  }
}
