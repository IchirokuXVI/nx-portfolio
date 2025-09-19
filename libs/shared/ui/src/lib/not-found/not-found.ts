import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';
import { forkJoin } from 'rxjs';

@Component({
  selector: 'lib-not-found',
  imports: [CommonModule],
  templateUrl: './not-found.html',
  styleUrl: './not-found.scss',
})
export class NotFoundComponent {
  compReady = signal(false);

  constructor() {
    RokuTranslator.addNamespace('not-found');

    forkJoin([
      RokuTranslator.addTranslations(
        'en',
        'not-found',
        () => import('./i18n/en.json')
      ),
      RokuTranslator.addTranslations(
        'es',
        'not-found',
        () => import('./i18n/es.json')
      ),
    ]).subscribe(() => {
      this.compReady.set(true);
    });
  }

  t(s: string) {
    return RokuTranslator.t(s);
  }
}
