import { inject, Injectable, signal } from '@angular/core';
import { BrowserFacade } from './browser-facade';
import { StorageKeys } from './storage-keys';

/** What the strip draws: whose account is open, and when the session stops. */
export interface SupportSessionView {
  readonly username: string;
  /** The deadline of the session (backend `0194`, the `until` of the `act` claim). */
  readonly until: Date;
}

/**
 * Whether this document holds a support session, and what the strip shows for it
 * (velista `0133`).
 *
 * ## Read one time
 *
 * {@link active} is the marker in `sessionStorage`, read as the service is created and
 * never again. A document does not become active, or stop being active, while it runs.
 * The handoff page writes the marker and the end of a session removes it, and both
 * then load a new document, which reads the marker afresh.
 *
 * ## Why `providedIn: 'root'`
 *
 * The answer is a fact about the document, and `BrowserFacade`, which changes where
 * every key is stored on it, is root as well. A root facade cannot read a service the
 * app provides below it. Mounted in the portfolio the root injector is the shell's,
 * and only this app reads the service.
 *
 * ## Who writes what
 *
 * `data-access` reads the pair and writes {@link session}: the name from the pair and
 * the deadline from the `act` claim of the access token. It also registers what "End"
 * does with {@link handleEnd}, because `ui` may not reach `data-access` (rule D1) and
 * the strip only says that somebody pressed it.
 *
 * No `@angular/core/rxjs-interop` here: it is not deduplicated across remotes.
 */
@Injectable({ providedIn: 'root' })
export class ImpersonationState {
  /** True for the life of a document that started with the marker in its tab. */
  readonly active: boolean;

  private readonly _session = signal<SupportSessionView | null>(null);

  /** What the strip draws, or null when no strip is drawn. Always null in an ordinary tab. */
  readonly session = this._session.asReadonly();

  private _onEnd: (() => void) | null = null;

  constructor() {
    this.active =
      inject(BrowserFacade).readSessionStorage(StorageKeys.supportSession) !==
      null;
  }

  /** Called by `data-access` as the pair changes. Ignored in an ordinary tab. */
  show(view: SupportSessionView | null): void {
    if (this.active) {
      this._session.set(view);
    }
  }

  /** `data-access` names what ending the session does. */
  handleEnd(onEnd: () => void): void {
    this._onEnd = onEnd;
  }

  /** The strip's "End" was pressed. */
  end(): void {
    this._onEnd?.();
  }
}
