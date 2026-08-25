import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { APP_BRAND } from '@portfolio/velista/models';
import { AppUiModule } from '../app-ui-module';

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
 * nothing else (plan 0002, section 4). Night is the default; `AppBrand.themeClass`
 * can override it so a rebrand ships a palette along with the name.
 *
 * The token definitions themselves are plan 0002's work. This component fixes only
 * *where* they live.
 *
 * `AppUiModule` is imported for its providers, not for a template symbol: being the
 * parent route component, this is where the `velista` i18n namespace has to be
 * registered so every page below inherits it.
 */
@Component({
  selector: 'lib-app-layout',
  imports: [AppUiModule, RouterOutlet],
  templateUrl: './app-layout.html',
  styleUrl: './app-layout.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'rootClass',
  },
})
export class AppLayout {
  private readonly _brand = inject(APP_BRAND);

  /**
   * Bound as one string rather than a static `class` plus a binding, so the theme
   * class and the token scope can never end up on different elements.
   */
  readonly rootClass = `app-root ${this._brand.themeClass ?? 'theme-night'}`;
}
