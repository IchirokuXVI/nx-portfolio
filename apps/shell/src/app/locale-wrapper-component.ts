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

      if (locale !== currentLocale) {
        // Parse the FULL current URL string into a UrlTree
        // (This preserves all child routes, query params, and fragments automatically)
        const urlTree = this.router.parseUrl(this.router.url);

        // Access the primary routing segments
        const primaryOutlet = urlTree.root.children['primary'];

        // Ensure segments exist, then replace the first segment (the locale)
        if (primaryOutlet && primaryOutlet.segments.length > 0) {
          primaryOutlet.segments[0].path = locale;
        }

        // Navigate using the modified tree without reloading the app
        // this.router.navigateByUrl(urlTree, { replaceUrl: true });
        window.location.href = urlTree.toString();
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
