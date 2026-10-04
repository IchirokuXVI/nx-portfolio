import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';

/**
 * Four tiles of unlike sizes: an overview of several things at once.
 *
 * Decorative: the control that holds it carries the name. It takes the colour
 * of the text around it and the size of the box it is put in.
 */
@Component({
  selector: 'lib-dashboard-icon',
  template: `<svg [innerHTML]="icon()" aria-hidden="true"></svg>`,
  styles: `
    :host {
      display: inline-flex;
      inline-size: 100%;
      block-size: 100%;
    }

    svg {
      inline-size: 100%;
      block-size: 100%;
      fill: currentColor;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardIcon {
  readonly icon = signal<SafeHtml | null>(null);

  private readonly _sanitizer = inject(DomSanitizer);

  constructor() {
    // The text of a file this library ships, so there is nothing in it to
    // sanitize. The query suffix is the bundler's and has no declaration.
    // @ts-expect-error a raw import has no type
    import('./dashboard-icon.svg?raw').then((file) => {
      this.icon.set(this._sanitizer.bypassSecurityTrustHtml(file.default));
    });
  }
}
