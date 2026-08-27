import { Injectable, signal } from '@angular/core';

/**
 * How the rename sheet tells the screen behind it what it did.
 *
 * Rule E1 makes the sheet a **child** of the account route, so `AccountPage` is alive
 * the whole time and never re-reads on arrival, because it never left. The name it
 * renders comes from `ProfileStore` and updates on its own, but a change nobody can see
 * is a change nobody who cannot see is told about: the sheet closes, and what it
 * changed is behind it (section 7).
 *
 * So the page keeps one `aria-live="polite"` region and this is what fills it. A signal
 * rather than a `(deactivate)` on the outlet, for `MemberListRefresh`'s reason: the
 * outlet cannot tell a sheet that saved from one that was cancelled, and announcing a
 * rename that did not happen is worse than announcing nothing.
 *
 * ## Why root scope is not a breach of rule D5
 *
 * D5 forbids a service resolving a token the app binds from an injector that does not
 * have it. This injects nothing, reaches no app token and holds one string, so it has
 * no way to do that.
 */
@Injectable({ providedIn: 'root' })
export class RenameAnnouncement {
  private readonly _name = signal<string | null>(null);

  /** The name just saved, or null when there is nothing to announce. */
  readonly name = this._name.asReadonly();

  record(name: string): void {
    this._name.set(name);
  }

  /** The page has announced it. It does not announce it twice. */
  clear(): void {
    this._name.set(null);
  }
}
