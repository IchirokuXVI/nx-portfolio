import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';

/**
 * A shield: the accounts that may use the back office.
 *
 * Decorative: the control that holds it carries the name. It takes the colour
 * of the text around it and the size of the box it is put in.
 */
@Component({
  selector: 'lib-shield-icon',
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
export class ShieldIcon {
  readonly icon = signal<SafeHtml | null>(null);

  private readonly _sanitizer = inject(DomSanitizer);

  constructor() {
    // The text of a file this library ships, so there is nothing in it to
    // sanitize. The query suffix is the bundler's and has no declaration.
    // @ts-expect-error a raw import has no type
    import('./shield-icon.svg?raw').then((file) => {
      this.icon.set(this._sanitizer.bypassSecurityTrustHtml(file.default));
    });
  }
}
