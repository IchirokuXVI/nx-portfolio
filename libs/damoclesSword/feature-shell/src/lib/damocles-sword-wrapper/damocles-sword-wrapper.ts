import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import {
  DAMOCLES_APP_KEY,
  DAMOCLES_LOCALES,
  DamoclesSwordUiModule,
} from '@portfolio/damoclesSword/ui';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';

@Component({
  selector: 'lib-damocles-sword-wrapper',
  imports: [DamoclesSwordUiModule, RouterOutlet],
  templateUrl: './damocles-sword-wrapper.html',
  styleUrl: './damocles-sword-wrapper.scss',
})
export class DamoclesSwordWrapper {
  router = inject(Router);
  activatedRoute = inject(ActivatedRoute);

  headerNavLinks = [
    {
      label: 'nav.home',
      url: ['./'],
    },
    {
      label: 'nav.services',
      url: ['./services'],
    },
    {
      label: 'nav.about',
      url: ['./about'],
    },
    {
      label: 'nav.contact',
      url: ['./contact'],
    },
  ];

  private _localeStore = inject(RokuLocaleStore);

  locales = DAMOCLES_LOCALES;

  /** Reads the store signal, so it stays in sync after an in-place switch. */
  selectedLocale = this._localeStore.locale;

  changeLocale(language: string) {
    // Post-render user switch: persist for this app and switch the language in
    // place, no reload (see 0003).
    void this._localeStore.switchAppLocale(DAMOCLES_APP_KEY, language);
  }
}
