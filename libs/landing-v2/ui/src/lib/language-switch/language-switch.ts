import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';
import {
  LANDING_V2_APP_KEY,
  LANDING_V2_LOCALES,
} from '../landing-v2-locales';

/**
 * Compact locale toggle shown in `SiteHeader` and `DetailPageShell`, the two
 * places every landingV2 page routes through.
 *
 * The options come from `LANDING_V2_LOCALES` (the same const landingV2 declares
 * to `RokuTranslatorModule.withConfig` and its route data), so the switcher only
 * ever offers locales this app actually ships.
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

  readonly locales = LANDING_V2_LOCALES;
  readonly selectedLocale = this._localeStore.locale;

  select(locale: string) {
    if (locale === this.selectedLocale()) {
      return;
    }

    void this._localeStore.switchAppLocale(LANDING_V2_APP_KEY, locale);
  }
}
