import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  GatewayError,
  NetworkError,
  SessionStore,
  ZoneStore,
} from '@portfolio/velista/data-access';
import type { HomeState } from '@portfolio/velista/models';
import { BrowserFacade, StorageKeys } from '@portfolio/velista/platform';
import {
  AppBar,
  BottomActionBar,
  EmptyState,
  ErrorState,
  GuestUpgradeBanner,
  ResumeListCard,
  ZoneCard,
  ZoneSkeleton,
} from '@portfolio/velista/ui';
import { selectHomeState } from './select-home-state';

/**
 * The dashboard: what a signed in user sees at `/<locale>/velista/home`.
 *
 * `0003` made this one adaptive route that rendered a front door or a dashboard
 * depending on authentication state. `0007` split it in two. The reasoning behind the
 * original decision survives, because `anonymousOnlyGuard` sends a signed in visitor
 * here from the mount before anything renders, so a returning user still arrives on
 * their groups in one navigation. What changed is that authentication now decides
 * **where you are** rather than what a `@switch` renders, which makes "signed in users
 * never see the front door" a test instead of an emergent behaviour, and stops this
 * page shipping the hero, the preview card and the auth actions to somebody who will
 * never see them.
 *
 * This is the container, and rule D1 (plan 0004) is what shapes it: it is the only
 * thing here that injects a data token, it holds the page's state, and it passes plain
 * values down to components that know nothing about a backend. Its only presentation
 * logic is choosing which state to render, and even that is delegated to a pure
 * function so it can be tested exhaustively without a fixture.
 */
@Component({
  selector: 'lib-home-page',
  imports: [
    RokuTranslatorPipe,
    AppBar,
    BottomActionBar,
    EmptyState,
    ErrorState,
    GuestUpgradeBanner,
    ResumeListCard,
    ZoneCard,
    ZoneSkeleton,
  ],
  templateUrl: './home-page.html',
  styleUrl: './home-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage {
  private readonly _zoneStore = inject(ZoneStore);
  private readonly _session = inject(SessionStore);
  private readonly _browser = inject(BrowserFacade);

  /**
   * Dismissal is session state, not persisted: `0003` requires the guest banner not to
   * reappear "within the same session", which is deliberately weaker than never again.
   * Somebody who taps Not now today should be asked again tomorrow, because the risk
   * it warns about has not gone away.
   */
  private readonly _guestBannerDismissed = signal(false);

  private readonly _correlationId = computed(() => {
    const error = this._zoneStore.error();
    return error instanceof GatewayError || error instanceof NetworkError
      ? error.correlationId
      : null;
  });

  /** The list this device last opened, resolved against the zones actually loaded. */
  private readonly _resumeListId = signal<string | null>(null);

  readonly state = computed<HomeState>(() => {
    const identity = this._session.identity();

    // Unreachable through the router: `authenticatedGuard` has already sent an
    // anonymous visitor to the front door before this page is created. It is written
    // out because the signal's type still admits it, and because a session that ends
    // while the page is mounted is a real event. The skeleton is the honest thing to
    // render for the frame before the guard's redirect completes; somebody else's
    // groups is not.
    if (identity.kind === 'anonymous') {
      return { kind: 'loading' };
    }

    return selectHomeState({
      identity,
      zones: this._zoneStore.myZones(),
      loadState: this._zoneStore.state(),
      correlationId: this._correlationId(),
      resumeListId: this._resumeListId(),
      guestBannerDismissed: this._guestBannerDismissed(),
    });
  });

  /**
   * The letter in the app bar's account button.
   *
   * From the global username the token pair now carries (backend plan 0018), so it
   * costs no request. Null falls back to a neutral glyph, which is right for a guest
   * whose pair predates that change rather than showing them somebody else's letter.
   */
  readonly accountInitial = computed(() => {
    const username = this._session.username();
    return username === null
      ? null
      : (Array.from(username)[0] ?? '').toLocaleUpperCase();
  });

  constructor() {
    this._resumeListId.set(this._browser.readStorage(StorageKeys.lastList));
    void this._zoneStore.load();
  }

  retry(): void {
    void this._zoneStore.load();
  }

  dismissGuestBanner(): void {
    this._guestBannerDismissed.set(true);
  }

  /**
   * Copies the support reference.
   *
   * Best effort: the Clipboard API needs a secure context and a user gesture, and it
   * rejects rather than throwing where it is unavailable. The reference is selectable
   * text as well, so a failure here costs nothing (plan 0003, section 7).
   */
  copyReference(reference: string): void {
    void this._browser.window?.navigator.clipboard
      ?.writeText(reference)
      .catch(() => undefined);
  }

  /**
   * Everything this page can start, and where each of them currently stops.
   *
   * Each of these leads somewhere `0003` puts out of scope: zone detail, list detail,
   * the join-by-code flow and the account upgrade each get their own plan and their own
   * approved mock before they are built. Creating a group is the subtle one: it needs a
   * name, and no sheet for typing one is drawn in the approved mock, so building it
   * here would break the project's own rule that nothing is built before its mock is
   * approved.
   *
   * They are recorded rather than left unbound so the controls are real, focusable and
   * testable now, and so that connecting each one later is a single line here instead
   * of a hunt through templates.
   */
  readonly pendingRoutes = signal<readonly string[]>([]);

  createZone(): void {
    this._notYetRouted('zones.create');
  }

  joinZone(): void {
    this._notYetRouted('zones.join');
  }

  openZone(zoneId: string): void {
    this._notYetRouted(`zones/${zoneId}`);
  }

  openList(listId: string): void {
    this._notYetRouted(`lists/${listId}`);
  }

  reviewRequests(zoneId: string): void {
    this._notYetRouted(`zones/${zoneId}/members`);
  }

  newList(): void {
    this._notYetRouted('lists.create');
  }

  search(): void {
    this._notYetRouted('search');
  }

  account(): void {
    this._notYetRouted('account');
  }

  secureAccount(): void {
    this._notYetRouted('account.upgrade');
  }

  /**
   * Records an action whose destination has not been built.
   *
   * Deliberately observable rather than an empty body: a test can assert that a button
   * is wired to the right destination, which is the half of this that will still be
   * true once the routes exist.
   */
  private _notYetRouted(destination: string): void {
    this.pendingRoutes.update((current) => [...current, destination]);
  }
}
