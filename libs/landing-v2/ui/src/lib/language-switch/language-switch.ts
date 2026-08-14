import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';
import { switchAppLocale } from '@portfolio/localization/rokutranslator-angular';
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
 * Selecting a locale delegates to `switchAppLocale`, which persists the choice
 * for this app and reloads to the new locale URL so localized data is
 * re-fetched (see 0002). The pressed state is tracked only for immediate
 * feedback before the reload.
 */
@Component({
  selector: 'lib-landing-v2-language-switch',
  templateUrl: './language-switch.html',
  styleUrl: './language-switch.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LanguageSwitch {
  readonly locales = LANDING_V2_LOCALES;
  readonly selectedLocale = signal(RokuTranslator.getLocale());

  select(locale: string) {
    if (locale === this.selectedLocale()) {
      return;
    }

    this.selectedLocale.set(locale);
    switchAppLocale(LANDING_V2_APP_KEY, locale);
  }
}
