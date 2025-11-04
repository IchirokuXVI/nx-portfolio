import { CommonModule } from '@angular/common';
import { Component, inject, Input, signal, ViewChild } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Component({
  selector: 'lib-close-icon',
  imports: [CommonModule],
  templateUrl: './close-icon.html',
  styleUrl: './close-icon.scss',
})
export class CloseIcon {
  _icon = signal<SafeHtml | null>(null);

  @Input() size: 'sm' | 'md' | 'lg' | 'xl' = 'md';
  @Input() sizeMultiplier: 1 | 2 | 3 = 1;

  private _sanitizer = inject(DomSanitizer);

  @ViewChild('iconContainer', { static: true }) iconContainer: any;

  constructor() {
    // @ts-expect-error I guess at some point I have to fix this...
    import('./close-icon.svg?raw').then((m) => {
      // TO-DO: Avoid using bypassSecurityTrustHtml and install DOMPurify or similar to sanitize the SVG
      const safeSvg = this._sanitizer.bypassSecurityTrustHtml(m.default);
      this._icon.set(safeSvg);
    });
  }
}
