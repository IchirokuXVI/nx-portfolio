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
  ReloadBlocker,
  StartupGate,
  ThemeStore,
} from '@portfolio/velista/platform';
import { AppUiModule } from '../app-ui-module';
import {
  ConnectionLost,
  StartupScreen,
  UpdateScreen,
} from '../home/state-panels';

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
    ConnectionLost,
    StartupScreen,
    UpdateScreen,
  ],
  templateUrl: './app-layout.html',
  styleUrl: './app-layout.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'rootClass()',
  },
})
export class AppLayout {
  private readonly _theme = inject(ThemeStore);
  private readonly _connection = inject(ConnectionState);
  private readonly _readiness = inject(BackendReadiness);
  private readonly _gate = inject(StartupGate);
  private readonly _reload = inject(ReloadBlocker);
  private readonly _updates = inject(AppUpdates);

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
