import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';

/**
 * Host for the locale route branch: just supplies the outlet the shell mounts
 * remotes into. Locale validation and correction now live in the locale routing
 * layer (the `localeSegmentMatcher`, `addLocaleRedirect`, and each app's
 * `localeCorrectionGuard`), so this component holds no locale logic.
 */
@Component({
  selector: 'ng-shell-locale-wrapper',
  styles: `
    :host {
      display: contents;
    }
  `,
  template: `<router-outlet></router-outlet>`,
  imports: [RouterModule],
})
export class LocaleWrapperComponent {}
