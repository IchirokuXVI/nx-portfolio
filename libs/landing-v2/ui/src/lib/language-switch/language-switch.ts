import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';

/**
 * Compact EN/ES toggle shown in `SiteHeader` and `DetailPageShell`, the two
 * places every landingV2 page routes through (0000-0004).
 *
 * Deliberately hardcodes `['en', 'es']` rather than reading
 * `RokuTranslator.getSupportedLocales()`: that list is global (`['en', 'es',
 * 'fr']`, see apps/shell/src/app/app.config.ts), and `landingV2`'s i18n
 * namespace only ships English and Spanish translations (see
 * `RokuTranslatorModule.withConfig` in landing-v2-ui-module.ts) - offering
 * 'fr' here would fall back to raw translation keys.
 *
 * Selecting a locale calls the shared `RokuTranslator` singleton directly,
 * the same pattern `LandingV2Wrapper`/`ProjectPage` already use to read
 * `RokuTranslator.getLocale()`. The shell's `LocaleWrapperComponent` reacts
 * to `onLocaleChange` with a full navigation to the new locale URL, so this
 * component only needs to track the pressed state for immediate feedback.
 */
@Component({
  selector: 'lib-landing-v2-language-switch',
  templateUrl: './language-switch.html',
  styleUrl: './language-switch.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LanguageSwitch {
  readonly locales = ['en', 'es'];
  readonly selectedLocale = signal(RokuTranslator.getLocale());

  select(locale: string) {
    if (locale === this.selectedLocale()) {
      return;
    }

    this.selectedLocale.set(locale);
    RokuTranslator.changeLocale(locale);
  }
}
