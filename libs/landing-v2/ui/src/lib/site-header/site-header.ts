import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
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
  imports: [AsyncPipe, RouterLink, RokuTranslatorPipe, DownloadIcon, LanguageSwitch],
  templateUrl: './site-header.html',
  styleUrl: './site-header.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SiteHeader {
  resumeLink = input<Promise<string> | null>(null);

  /** Landing root for the active locale, e.g. `/en` — the brand's home link. */
  readonly homeLink = `/${RokuTranslator.getLocale()}`;
}
