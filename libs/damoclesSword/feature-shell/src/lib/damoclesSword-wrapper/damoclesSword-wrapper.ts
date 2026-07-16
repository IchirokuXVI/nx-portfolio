import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import { DamoclesSwordUiModule } from '@portfolio/damoclesSword/ui';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';

@Component({
  selector: 'lib-damoclesSword-wrapper',
  imports: [DamoclesSwordUiModule, RouterOutlet],
  templateUrl: './damoclesSword-wrapper.html',
  styleUrl: './damoclesSword-wrapper.scss',
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
    this.locales = RokuTranslator.getSupportedLocales();
    this.selectedLocale = RokuTranslator.getLocale();
  }

  changeLocale(language: string) {
    console.log('Locale in damoclesSword changed to:', language);

    this.selectedLocale = language;
    RokuTranslator.changeLocale(language);
  }
}
