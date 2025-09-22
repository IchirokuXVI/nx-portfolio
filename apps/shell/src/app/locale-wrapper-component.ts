import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';

const SUPPORTED_LOCALES = ['en', 'es'];

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
    this.route.paramMap
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe(async (params) => {
        const originalLocale = params.get('locale');
        let locale = originalLocale;

        if (!locale) {
          locale = RokuTranslator.getLocale();
        }

        if (!locale || !SUPPORTED_LOCALES.includes(locale)) {
          locale = 'en';
        }

        if (locale !== originalLocale) {
          // Rebuild the URL, replace first segment (locale) only
          const tree = this.router.createUrlTree(
            [
              locale,
              ...this.route.snapshot.url.map((seg) => seg.path).slice(1),
            ],
            {
              queryParams: this.route.snapshot.queryParams,
              fragment: this.route.snapshot.fragment || undefined,
            }
          );

          // Navigate without reloading the whole app
          this.router.navigateByUrl(tree, { replaceUrl: true });
        } else {
          RokuTranslator.changeLocale(locale);
        }
      });
  }
}
