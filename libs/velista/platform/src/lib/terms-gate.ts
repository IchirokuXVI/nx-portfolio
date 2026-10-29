import {
  computed,
  inject,
  Injectable,
  signal,
  type Signal,
} from '@angular/core';
import {
  NavigationEnd,
  Router,
  type ActivatedRouteSnapshot,
} from '@angular/router';
import { filter } from 'rxjs';
import { ImpersonationState } from './impersonation-state';

/**
 * Route `data` flag naming a page somebody must be able to read, or a link they must be
 * able to finish, before they accept the terms (velista `0173`, D4).
 *
 * Carried by the two documents, the Google callback, the email confirmation and reset
 * links, and the page a support session ends on. The prompt stands down on them and
 * comes back on the next page. A flag on the route rather than a list in the layout,
 * as `RENDERS_WHILE_CONNECTING` and `WORKS_WITHOUT_BACKEND` are.
 */
export const READ_BEFORE_TERMS = 'readBeforeTerms';

/** Where an accept stands. `failed` until the next press. */
export type TermsGateState = 'idle' | 'accepting' | 'failed';

/** What `report` is told beside the two facts the plan names. */
export interface TermsReportDetails {
  /** Whether the account accepted an older version, which picks the prompt's heading. */
  readonly acceptedBefore?: boolean;
  /** Whether "Sign out" is offered: for an account with credentials, never a guest. */
  readonly canSignOut?: boolean;
}

/**
 * Whether the app must ask the account to accept the terms before it goes on
 * (velista `0173`, target 8).
 *
 * ## Why it is here
 *
 * `AppLayout` draws the prompt, and `AppLayout` lives in `ui`, which may not reach the
 * stores in `data-access` or inject `Router` (rule D1). The facts live in `ProfileStore`
 * and the route data, so this service holds the answer and `app-providers.ts`, the one
 * file that sees both libraries, feeds it, as it feeds the tour.
 *
 * ## When the prompt is drawn
 *
 * {@link promptShown}: the account must accept, the tab is not a support session (an
 * operator must never accept for somebody), and the deepest route does not carry
 * {@link READ_BEFORE_TERMS}.
 *
 * ## The press
 *
 * {@link accept} calls the acceptor `app-providers.ts` registered (the data-access call,
 * then a read of the profile). The answer arrives through `report`, never through this
 * method: a stale version reads the profile again and the prompt redraws with the
 * version it now asks for.
 */
@Injectable({ providedIn: 'root' })
export class TermsGate {
  private readonly _router = inject(Router);
  private readonly _support = inject(ImpersonationState);

  private readonly _required = signal(false);
  private readonly _version = signal<string | null>(null);
  private readonly _acceptedBefore = signal(false);
  private readonly _canSignOut = signal(false);
  private readonly _state = signal<TermsGateState>('idle');

  /**
   * Seeded from the current snapshot, for `StartupGate`'s reason: the first navigation
   * can end before anything injects this.
   */
  private readonly _readFirst = signal(
    readsFlag(this._router.routerState.snapshot.root)
  );

  private _acceptor: ((version: string) => Promise<void>) | null = null;
  private _signOut: (() => void) | null = null;
  private readonly _hasSignOut = signal(false);

  /** Whether the account must accept the current version. False until told. */
  readonly required: Signal<boolean> = this._required.asReadonly();

  /** The version the press accepts, or null until told. */
  readonly version: Signal<string | null> = this._version.asReadonly();

  readonly state: Signal<TermsGateState> = this._state.asReadonly();

  /** Whether an older version was accepted: "We have new Terms" rather than "Before you go on". */
  readonly acceptedBefore: Signal<boolean> = this._acceptedBefore.asReadonly();

  /** Whether the prompt offers "Sign out". */
  readonly canSignOut: Signal<boolean> = computed(
    () => this._canSignOut() && this._hasSignOut()
  );

  /** Whether `AppLayout` draws the prompt in place of the page. */
  readonly promptShown: Signal<boolean> = computed(
    () =>
      this._required() &&
      this._version() !== null &&
      !this._support.active &&
      !this._readFirst()
  );

  constructor() {
    // Nothing unsubscribes, for `StartupGate`'s reason: the router outlives this
    // service, and `@angular/core/rxjs-interop` is not available here.
    this._router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() =>
        this._readFirst.set(readsFlag(this._router.routerState.snapshot.root))
      );
  }

  /**
   * What the profile says, called by `app-providers.ts` whenever it changes.
   *
   * A version that is not the one an earlier press failed on clears the failure, so a
   * prompt that redraws for new terms does not open with an old sentence.
   */
  report(
    required: boolean,
    version: string | null,
    details: TermsReportDetails = {}
  ): void {
    if (version !== this._version()) {
      this._state.set('idle');
    }
    this._required.set(required);
    this._version.set(version);
    this._acceptedBefore.set(details.acceptedBefore === true);
    this._canSignOut.set(details.canSignOut === true);
  }

  /** The data-access half of the press. Registered once, by `app-providers.ts`. */
  handleAccept(acceptor: (version: string) => Promise<void>): void {
    this._acceptor = acceptor;
  }

  /** What "Sign out" does. Registered once, by `app-providers.ts`. */
  handleSignOut(signOut: () => void): void {
    this._signOut = signOut;
    this._hasSignOut.set(true);
  }

  /**
   * The press. Calls the acceptor once; a second press while one is on its way does
   * nothing. Never called in a support session, whatever asks.
   */
  async accept(): Promise<void> {
    const version = this._version();
    const acceptor = this._acceptor;
    if (
      this._state() === 'accepting' ||
      !this._required() ||
      version === null ||
      acceptor === null ||
      this._support.active
    ) {
      return;
    }

    this._state.set('accepting');
    try {
      await acceptor(version);
      // Still `accepting` only if nothing reported a new version meanwhile.
      if (this._state() === 'accepting') {
        this._state.set('idle');
      }
    } catch {
      this._state.set('failed');
    }
  }

  /** "Sign out", when offered. */
  signOut(): void {
    if (this.canSignOut()) {
      this._signOut?.();
    }
  }
}

/** Whether the deepest activated route carries {@link READ_BEFORE_TERMS}. */
function readsFlag(from: ActivatedRouteSnapshot): boolean {
  let deepest = from;
  while (deepest.firstChild !== null) {
    deepest = deepest.firstChild;
  }

  return deepest.data[READ_BEFORE_TERMS] === true;
}
