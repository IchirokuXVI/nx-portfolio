import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import {
  DAMOCLES_APP_KEY,
  DamoclesSwordUiModule,
} from '@portfolio/damoclesSword/ui';
import {
  APP_MOUNT_PATH,
  RokuLocaleStore,
} from '@portfolio/localization/rokutranslator-angular';
import { DAMOCLES_USABLE_LOCALES } from '../usable-locales';

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
  private _mountPath = inject(APP_MOUNT_PATH);

  locales = DAMOCLES_USABLE_LOCALES;

  /** Reads the store signal, so it stays in sync after an in-place switch. */
  selectedLocale = this._localeStore.locale;

  changeLocale(language: string) {
    // Post-render user switch: persist for this app and switch the language in
    // place, no reload (see 0003).
    //
    // The mount is passed because the locale sits *below* it now: rewriting index 0
    // would replace `damoclesSword` itself and send the visitor to `/en/en/about`.
    // Read from DI rather than written down, so the standalone build (mount `''`)
    // needs no branch here. A component injector resolves it without the timing
    // problem a route guard has, which is why the guard reads the same value from
    // route data instead.
    void this._localeStore.switchAppLocale(
      DAMOCLES_APP_KEY,
      language,
      this._mountPath
    );
  }
}
