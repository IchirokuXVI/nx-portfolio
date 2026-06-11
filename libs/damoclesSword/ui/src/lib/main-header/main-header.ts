import { AsyncPipe } from '@angular/common';
import { Component, inject, input, output, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { LanguageSelector } from '../language-selector/language-selector';

@Component({
  selector: 'lib-damoclesSword-main-header',
  imports: [AsyncPipe, RouterModule, LanguageSelector, RokuTranslatorPipe],
  templateUrl: './main-header.html',
  styleUrl: './main-header.scss',
})
export class MainHeader {
  // @ts-expect-error TypeScript cannot resolve dynamic imports with relative paths in module federation setup
  damoclesLogo = import(`../../../assets/damoclesSwordLogo.svg`).then(
    (m) => m.default
  );

  compReady = signal(false);

  languages = input<string[]>([]);
  selectedLanguage = input<string>('en');
  languageChange = output<string>();

  navLinks = [
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

  _rokuTranslatorServ = inject(RokuTranslatorService);

  constructor() {
    this._rokuTranslatorServ.loaded$.subscribe(() => {
      this.compReady.set(true);
    });
  }
}
