import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import {
  ConnectionState,
  ReloadBlocker,
  ThemeStore,
} from '@portfolio/velista/platform';
import { AppUiModule } from '../app-ui-module';
import { ConnectionLost } from '../home/state-panels';

/**
 * The app's own root. Every route in this app renders inside it.
 *
 * Two jobs, both required by the extraction contract in plan 0001:
 *
 * - **Item 1, the app owns its chrome.** Header, navigation and footer are drawn
 *   here, never by the portfolio shell, and nothing outside this host is styled.
 *   They arrive with the page plans; today this is the outlet and the root scope.
 * - **Item 4, its own theme tokens.** `.app-root` carries them instead of `:root`,
 *   so the shell's global styles and this app's tokens cannot leak into each other
 *   in either direction. On extraction that selector moves to `:root` unchanged.
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
  imports: [AppUiModule, RouterOutlet, ConnectionLost],
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
  private readonly _reload = inject(ReloadBlocker);

  /**
   * Whether to cover the page with the connection screen.
   *
   * Read from `platform`, not from `data-access`: rule D1 forbids this library from
   * importing the latter, and resolving that is exactly why `platform` exists
   * (plan 0004, section 3).
   */
  readonly offline = this._connection.offline;

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
   * Bound as one string rather than a static `class` plus a separate binding, so
   * the token scope and the theme can never end up on different elements. That
   * would leave the app with primitives and no semantic layer, and every colour
   * resolving to nothing.
   */
  readonly rootClass = computed(() => `app-root ${this._theme.themeClass()}`);
}
