import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  injectSupportedLocales,
  RokuLocaleStore,
} from '@portfolio/localization/rokutranslator-angular';
import {
  LANDING_V2_APP_KEY,
  LANDING_V2_AVAILABLE_LOCALES,
} from '../landing-v2-locales';

/**
 * Compact locale toggle shown in `SiteHeader` and `DetailPageShell`, the two
 * places every landingV2 page routes through.
 *
 * The options come from the app's enabled locales, read off the route `data`
 * (`supportedLocales`, set by the feature-shell) so the switcher always matches
 * whatever the app turned on — not a hardcoded UI constant. Outside a route (bare
 * component tests) it falls back to every available locale.
 *
 * Selecting a locale delegates to `RokuLocaleStore.switchAppLocale`, which
 * persists the choice for this app and switches the language in place (no reload,
 * see 0003). The pressed state reads the store's locale signal, so it stays in
 * sync with the active locale automatically.
 */
@Component({
  selector: 'lib-landing-v2-language-switch',
  templateUrl: './language-switch.html',
  styleUrl: './language-switch.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LanguageSwitch {
  private _localeStore = inject(RokuLocaleStore);

  readonly locales = injectSupportedLocales() ?? LANDING_V2_AVAILABLE_LOCALES;
  readonly selectedLocale = this._localeStore.locale;

  select(locale: string) {
    if (locale === this.selectedLocale()) {
      return;
    }

    void this._localeStore.switchAppLocale(LANDING_V2_APP_KEY, locale);
  }
}
