import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  AppUpdates,
  BackendReadiness,
  ConnectionState,
  LiveBasketBadge,
  NavChrome,
  ReloadBlocker,
  StartupGate,
  ThemeStore,
  TourAnchor,
  TourStore,
} from '@portfolio/velista/platform';
import { AppUiModule } from '../app-ui-module';
import {
  ConnectionLost,
  StartupScreen,
  UpdateScreen,
} from '../home/state-panels';
import { TourCard } from '../tour/tour-card';
import { TourSpotlight } from '../tour/tour-spotlight';
import { AppNav } from './app-nav';

/**
 * The app's own root. Every route in this app renders inside it.
 *
 * Three jobs now, and the first two are required by the extraction contract in
 * plan 0001:
 *
 * - **Item 1, the app owns its chrome.** Header, navigation and footer are drawn
 *   here, never by the portfolio shell, and nothing outside this host is styled.
 *   They arrive with the page plans; today this is the outlet and the root scope.
 * - **Item 4, its own theme tokens.** `.app-root` carries them instead of `:root`,
 *   so the shell's global styles and this app's tokens cannot leak into each other
 *   in either direction. On extraction that selector moves to `:root` unchanged.
 * - **The startup gate** (plan 0071). Whether a page may render at all is applied
 *   here and nowhere else, because this is the parent of every page and no page can
 *   tell it anything before it has been created. What it applies is `StartupGate`'s
 *   answer: the question involves reading the router, which rule D1 keeps out of this
 *   library.
 *
 * The theme is a class on the same element that redefines the semantic layer and
 * nothing else (plan 0002, section 4). Which class that is comes from `ThemeStore`,
 * which resolves an explicit user choice, then the operating system, then Night.
 *
 * `AppUiModule` is imported for its providers, not for a template symbol: being the
 * parent route component, this is where the `velista` i18n namespace has to be
 * registered so every page below inherits it.
 */
@Component({
  selector: 'lib-app-layout',
  imports: [
    AppUiModule,
    RokuTranslatorPipe,
    RouterOutlet,
    AppNav,
    TourAnchor,
    TourCard,
    TourSpotlight,
    ConnectionLost,
    StartupScreen,
    UpdateScreen,
  ],
  templateUrl: './app-layout.html',
  styleUrl: './app-layout.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'rootClass()',
    '[class.nav-up]': 'navReserved()',
  },
})
export class AppLayout {
  private readonly _theme = inject(ThemeStore);
  private readonly _connection = inject(ConnectionState);
  private readonly _readiness = inject(BackendReadiness);
  private readonly _gate = inject(StartupGate);
  private readonly _reload = inject(ReloadBlocker);
  private readonly _updates = inject(AppUpdates);
  private readonly _nav = inject(NavChrome);
  private readonly _badge = inject(LiveBasketBadge);
  private readonly _tour = inject(TourStore);

  /**
   * Whether to cover the page with the connection screen.
   *
   * Read from `platform`, not from `data-access`: rule D1 forbids this library from
   * importing the latter, and resolving that is exactly why `platform` exists
   * (plan 0004, section 3).
   */
  readonly offline = this._connection.offline;

  /** See {@link StartupScreen}. Wall clock from the app starting, per 0071 D8. */
  readonly startupSlow = this._readiness.slow;

  /**
   * Whether the deployment refuses this build (plan 0072).
   *
   * `state()` and not `wasReady()`, which is the opposite reading from the startup
   * gate above and deliberately so. The gate is about starting and opens once, because
   * closing it later would destroy a live page and whatever was typed into it. This is
   * about a build that is wrong: a session that has been running for an hour is in
   * exactly the same position as one that has just started, because both are refused
   * on every request from here on, and there is no half typed field worth keeping in a
   * form that cannot be submitted.
   */
  readonly mustUpdate = computed(() => this._readiness.state() === 'too-old');

  /** Which of the update screen's two faces to draw. See {@link UpdateScreen}. */
  readonly updateFailed = this._updates.updateFailed;

  /**
   * Whether the outlet may exist.
   *
   * **The cover holds the outlet rather than sitting over it** (D3). An overlay drawn
   * over a live outlet leaves the page below constructed, so its resolvers run and its
   * requests go out on behalf of somebody who has just been told to wait. `offline` is
   * the opposite case and keeps its overlay, because there the page below is already
   * alive and its half typed fields are worth preserving.
   *
   * The whole answer comes from `StartupGate`, including which route may draw while
   * connecting. That reading is a router read, and rule D1 keeps every router read out
   * of this library: see the service for what it decides and why it lives where it does.
   */
  readonly rendersNow = this._gate.rendersNow;

  /**
   * Whether the bottom bar is drawn on the screen the app is on (plan 0097).
   *
   * Read from `platform` for the reason `offline` is: the question needs the URL and
   * the activated route's `data`, and rule D1 keeps every router read out of this
   * library. See {@link NavChrome} for the three things that close it.
   */
  readonly navVisible = this._nav.visible;

  /**
   * Whether the page leaves room at its foot for the bar.
   *
   * `reserved` and not `visible`, which differ on exactly one thing: a sheet hides the
   * bar and keeps its room. Reserving on `visible` would reflow the page under every
   * sheet by the height of the bar on the way in and back again on the way out.
   */
  readonly navReserved = this._nav.reserved;

  /** Where the app is, which is the only thing that decides the active tab. */
  readonly navUrl = this._nav.url;

  /** The count over the third tab's glyph, or null. Written by `data-access`. */
  readonly navBadge = this._badge.pending;

  /**
   * Whether the tour is over the app (velista `0099`).
   *
   * While a run is going, card or no card: between stops the screen stays dimmed and
   * inert, so nothing can be pressed while the app moves. Never over a sheet, and never
   * over the screens that replace the outlet, because there is nothing there to light.
   */
  readonly tourUp = computed(
    () =>
      this._tour.running() &&
      !this._nav.sheetOpen() &&
      this.rendersNow() &&
      !this.mustUpdate()
  );

  /** The card to draw, from `TourStore`, which reads the router on this one's behalf. */
  readonly tourCard = this._tour.card;

  /** Next, or Finish on the last card. */
  tourNext(): void {
    this._tour.next();
  }

  /** Skip the tour, and Escape. */
  tourSkip(): void {
    this._tour.skip();
  }

  /** Somebody pressed Try again on the startup screen. */
  retryConnection(): void {
    this._readiness.requestRetry();
  }

  /**
   * The quiet "Reload now" button.
   *
   * Goes through `ReloadBlocker` and bypasses nothing. Somebody tapping it has not
   * stopped caring about the half-typed field behind the screen, and with no offline
   * queue in this phase that text is gone for good if the reload wins the race.
   */
  reloadNow(): void {
    this._reload.reloadWhenIdle();
  }

  /**
   * The Try again button on the dead end face.
   *
   * Straight through, blocking nothing and counting nothing (plan 0072 D7 and D4).
   * The reason `reloadNow` above goes through `ReloadBlocker` does not apply here:
   * the form it would protect cannot be submitted by a client every one of whose
   * requests is refused.
   */
  reloadForUpdate(): void {
    this._updates.reloadByHand();
  }

  /**
   * Bound as one string rather than a static `class` plus a separate binding, so
   * the token scope and the theme can never end up on different elements. That
   * would leave the app with primitives and no semantic layer, and every colour
   * resolving to nothing.
   */
  readonly rootClass = computed(() => `app-root ${this._theme.themeClass()}`);
}
