import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import { DownloadIcon } from '@portfolio/shared/ui';
import { LanguageSwitch } from '../language-switch/language-switch';

/**
 * The header keeps the brand mark and the Download CV action, but drops
 * navigation *links* entirely (brief #1) — the page is a single scroll, so a
 * nav added nothing. The EN/ES `LanguageSwitch` sits next to the CV action.
 *
 * The brand itself is a link back to the locale landing root (`/{locale}`),
 * so every landingV2 page — the header being shared by all of them via the
 * Layout — has a way home. This is what replaced the detail pages' old
 * dedicated back button.
 */
@Component({
  selector: 'lib-landing-v2-site-header',
  imports: [
    AsyncPipe,
    RouterLink,
    RokuTranslatorPipe,
    DownloadIcon,
    LanguageSwitch,
  ],
  templateUrl: './site-header.html',
  styleUrl: './site-header.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SiteHeader {
  resumeLink = input<Promise<string> | null>(null);

  private readonly _locale = inject(RokuLocaleStore).locale;

  /**
   * Landing root for the active locale, e.g. `/en` — the brand's home link.
   *
   * A computed over the store rather than a string read once at construction. It
   * used to call the module global's `getLocale()` in a field initializer, which
   * both froze the link at whatever the locale was when the header was first
   * created and reached for a singleton that no longer exists (plan 0005 D1). The
   * store is the app's locale, and reading it here re-renders this OnPush view on a
   * switch, which the frozen string never did.
   */
  readonly homeLink = computed(() => `/${this._locale()}`);
}
