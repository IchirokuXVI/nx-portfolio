import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import {
  DAMOCLES_APP_KEY,
  DAMOCLES_LOCALES,
  DamoclesSwordUiModule,
} from '@portfolio/damoclesSword/ui';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';
import { switchAppLocale } from '@portfolio/localization/rokutranslator-angular';

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

  locales: string[];

  selectedLocale: string;

  constructor() {
    this.locales = DAMOCLES_LOCALES;
    this.selectedLocale = RokuTranslator.getLocale();
  }

  changeLocale(language: string) {
    // Post-render user switch: persist for this app and reload to the new
    // locale URL so localized data is re-fetched (see 0002).
    switchAppLocale(DAMOCLES_APP_KEY, language);
  }
}
