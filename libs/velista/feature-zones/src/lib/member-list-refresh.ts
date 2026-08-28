import { Injectable, signal } from '@angular/core';

/**
 * How a member action sheet tells the screen behind it that a row changed.
 *
 * Rule E1 makes the four action sheets **children** of the members route, so
 * `MembersPage` is alive the whole time a sheet is over it and never re-reads on
 * arrival, because it never left. Its load effect is keyed on the zone and on the
 * statuses, neither of which a rename touches. This is the third key.
 *
 * ## Why root scope is not a breach of rule D5
 *
 * D5 forbids a service resolving a token the app binds from an injector that does not
 * have it. This injects nothing, reaches no app token and holds one integer, so it has
 * no way to do that.
 *
 * ## Why not `<router-outlet (deactivate)="refresh()" />`
 *
 * That is the one line version of the same idea and it cannot tell a sheet that wrote
 * something from a sheet that was cancelled, so every dismissal would cost a page of
 * members. The router also deactivates a child outlet on the way to destroying its
 * parent, so leaving the screen entirely would fire one more request whose answer is
 * thrown away.
 */
@Injectable({ providedIn: 'root' })
export class MemberListRefresh {
  private readonly _token = signal(0);

  /** Bumped by a sheet that changed a row. Read by the screen behind it. */
  readonly token = this._token.asReadonly();

  record(): void {
    this._token.update((n) => n + 1);
  }
}
