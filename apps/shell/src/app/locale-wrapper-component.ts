import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';

@Component({
  selector: 'ng-shell-locale-wrapper',
  styles: `
    :host {
      display: contents;
    }
  `,
  template: `<router-outlet></router-outlet>`,
  imports: [CommonModule, RouterModule],
})
export class LocaleWrapperComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private _destroyRef = inject(DestroyRef);

  constructor() {
    RokuTranslator.onLocaleChange = (locale: string) => {
      const currentLocale = this.route.snapshot.paramMap.get('locale');

      if (!locale) {
        console.error(
          'Locale change event triggered with empty locale. Defaulting to "en".'
        );
        locale = 'en';
      }

      if (locale !== currentLocale) {
        // Parse the FULL current URL string into a UrlTree
        // (This preserves all child routes, query params, and fragments automatically)
        const urlTree = this.router.parseUrl(this.router.url);

        // Access the primary routing segments
        const primaryOutlet = urlTree.root.children['primary'];

        let newUrl;

        if (primaryOutlet && primaryOutlet.segments.length > 0) {
          // Replace the first segment (the locale) with the new locale
          primaryOutlet.segments[0].path = locale;
          newUrl = urlTree.toString();
        } else {
          // If there are no segments, we are likely at the root. Just prepend the locale.
          newUrl = `/${locale}`;
        }

        // Navigate using the modified tree without reloading the app
        window.location.href = newUrl;
      }
    };

    this.route.paramMap
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe(async (params) => {
        const originalLocale = params.get('locale') || '';
        let locale = RokuTranslator.formatLocale(originalLocale);

        if (!locale) {
          locale = RokuTranslator.getLocale();
        }

        if (!locale || !RokuTranslator.isLocaleSupported(locale)) {
          locale = 'en';
        }

        RokuTranslator.changeLocale(locale);
      });
  }
}
