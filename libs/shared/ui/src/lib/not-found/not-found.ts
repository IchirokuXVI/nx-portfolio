import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import {
  provideRokuTranslator,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';

@Component({
  selector: 'lib-not-found',
  imports: [CommonModule, RokuTranslatorPipe],
  templateUrl: './not-found.html',
  styleUrl: './not-found.scss',
  providers: [
    provideRokuTranslator({
      locales: ['en', 'es'],
      defaultNamespace: 'shared/ui',
      loader: (locale) => import(`./i18n/${locale}.json`),
    }),
  ],
})
export class NotFoundComponent {
  compReady = signal(false);

  private _translateServ = inject(RokuTranslatorService);

  constructor() {
    this._translateServ.loaded$.subscribe(() => {
      this.compReady.set(true);
    });
  }
}
