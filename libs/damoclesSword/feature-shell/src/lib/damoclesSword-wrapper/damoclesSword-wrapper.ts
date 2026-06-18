import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import { DamoclesSwordUiModule } from '@portfolio/damoclesSword/ui';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';

@Component({
  selector: 'lib-damoclesSword-wrapper',
  imports: [CommonModule, DamoclesSwordUiModule, RouterOutlet],
  templateUrl: './damoclesSword-wrapper.html',
  styleUrl: './damoclesSword-wrapper.scss',
})
export class DamoclesSwordWrapper implements OnInit {
  router = inject(Router);
  activatedRoute = inject(ActivatedRoute);

  headerNavLinks = [
    {
      label: 'header.home',
      url: ['./'],
    },
    {
      label: 'header.services',
      url: ['./services'],
    },
    {
      label: 'header.about',
      url: ['./about'],
    },
    {
      label: 'header.contact',
      url: ['./contact'],
    },
  ];

  locales: string[];

  selectedLocale: string;

  constructor() {
    this.locales = RokuTranslator.getSupportedLocales();
    this.selectedLocale = RokuTranslator.getLocale();
  }

  ngOnInit() {}

  changeLocale(language: string) {
    console.log('Locale in damoclesSword changed to:', language);

    this.selectedLocale = language;
    RokuTranslator.changeLocale(language);
  }
}
