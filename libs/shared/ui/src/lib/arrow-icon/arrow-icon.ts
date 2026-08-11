import { CommonModule } from '@angular/common';
import { Component, inject, Input, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Component({
  selector: 'lib-arrow-icon',
  imports: [CommonModule],
  templateUrl: './arrow-icon.html',
  styleUrl: './arrow-icon.scss',
})
export class ArrowIcon {
  _icon = signal<SafeHtml | null>(null);

  @Input() color = 'currentColor';

  private _sanitizer = inject(DomSanitizer);

  constructor() {
    // @ts-expect-error I guess at some point I have to fix this...
    import('./arrow-icon.svg?raw').then((m) => {
      // TO-DO: Avoid using bypassSecurityTrustHtml and install DOMPurify or similar to sanitize the SVG
      const safeSvg = this._sanitizer.bypassSecurityTrustHtml(m.default);
      this._icon.set(safeSvg);
    });
  }
}
