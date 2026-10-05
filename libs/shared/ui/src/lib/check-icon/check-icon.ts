import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';

/**
 * A check mark: it went through.
 *
 * Decorative: the sentence beside it says what was done. It takes the colour
 * of the text around it and the size of the box it is put in.
 */
@Component({
  selector: 'lib-check-icon',
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
export class CheckIcon {
  readonly icon = signal<SafeHtml | null>(null);

  private readonly _sanitizer = inject(DomSanitizer);

  constructor() {
    // The text of a file this library ships, so there is nothing in it to
    // sanitize. The query suffix is the bundler's and has no declaration.
    // @ts-expect-error a raw import has no type
    import('./check-icon.svg?raw').then((file) => {
      this.icon.set(this._sanitizer.bypassSecurityTrustHtml(file.default));
    });
  }
}
