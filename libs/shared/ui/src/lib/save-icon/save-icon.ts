import { CommonModule } from '@angular/common';
import { Component, inject, Input, signal, ViewChild } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Component({
  selector: 'lib-save-icon',
  imports: [CommonModule],
  templateUrl: './save-icon.html',
  styleUrl: './save-icon.scss',
})
export class SaveIcon {
  _icon = signal<SafeHtml | null>(null);

  @Input() size: 'sm' | 'md' | 'lg' | 'xl' = 'md';
  @Input() sizeMultiplier: 1 | 2 | 3 = 1;
  @Input() color: string = '#66aa33';

  private _sanitizer = inject(DomSanitizer);

  @ViewChild('iconContainer', { static: true }) iconContainer: any;

  constructor() {
    // @ts-expect-error I guess at some point I have to fix this...
    import('./save-icon.svg?raw').then((m) => {
      // TO-DO: Avoid using bypassSecurityTrustHtml and install DOMPurify or similar to sanitize the SVG
      const safeSvg = this._sanitizer.bypassSecurityTrustHtml(m.default);
      this._icon.set(safeSvg);
    });
  }
}
