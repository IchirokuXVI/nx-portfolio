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
import type { PreviewLineVm } from '@portfolio/velista/models';
import { BrowserFacade, StorageKeys } from '@portfolio/velista/platform';
import {
  AppBar,
  AuthActions,
  BottomActionBar,
  EmptyState,
  ErrorState,
  GuestUpgradeBanner,
  HomeHero,
  ListPreviewCard,
  ResumeListCard,
  ZoneCard,
  ZoneSkeleton,
} from '@portfolio/velista/ui';
import { selectHomeState } from './select-home-state';

/**
 * The home page: the app's front door and its dashboard, on one route.
 *
 * Those are usually two pages. They are deliberately one here because the product is
 * meant to be installed and launched from a phone home screen, and a marketing page a
 * returning user has to navigate past every time is a tax on the main use case
 * (plan 0003, section 1). So the route is **adaptive**: what it renders is a function
 * of authentication state.
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
    AuthActions,
    BottomActionBar,
    EmptyState,
    ErrorState,
    GuestUpgradeBanner,
    HomeHero,
    ListPreviewCard,
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

  readonly state = computed(() =>
    selectHomeState({
      identity: this._session.identity(),
      zones: this._zoneStore.myZones(),
      loadState: this._zoneStore.state(),
      correlationId: this._correlationId(),
      resumeListId: this._resumeListId(),
      guestBannerDismissed: this._guestBannerDismissed(),
    })
  );

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

  /**
   * The illustrative list on the anonymous screen.
   *
   * Invented, and it stays invented. It shows all three line states because "some of
   * these are done and somebody else did them" is the whole idea of the product and is
   * hard to say in a sentence. The strings are **not** translated: they are stand-in
   * groceries, and a translator asked to localize "Milk" here would reasonably wonder
   * what it is for. Only the status chip beside them is a real key.
   */
  readonly previewLines: readonly PreviewLineVm[] = [
    { content: 'Milk', quantity: '2 L', status: 'READY', by: 'A' },
    { content: 'Bread', quantity: '1', status: 'PENDING', by: null },
    { content: 'Tomatoes', quantity: '', status: 'NOT_AVAILABLE', by: 'M' },
  ];

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
   * the join-by-code flow, the auth screens and the account upgrade each get their own
   * plan and their own approved mock before they are built. Creating a group is the
   * subtle one: it needs a name, and no sheet for typing one is drawn in the approved
   * mock, so building it here would break the project's own rule that nothing is built
   * before its mock is approved.
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

  continueWithGoogle(): void {
    this._notYetRouted('auth.google');
  }

  signInWithEmail(): void {
    this._notYetRouted('auth.login');
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

  changeLocale(): void {
    this._notYetRouted('settings');
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
