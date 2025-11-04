import { CommonModule } from '@angular/common';
import { Component, inject, Input, signal, ViewChild } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Component({
  selector: 'lib-trash-icon',
  imports: [CommonModule],
  templateUrl: './trash-icon.html',
  styleUrl: './trash-icon.scss',
})
export class TrashIcon {
  _icon = signal<SafeHtml | null>(null);

  @Input() color: string = '#994040';

  private _sanitizer = inject(DomSanitizer);

  @ViewChild('iconContainer', { static: true }) iconContainer: any;

  constructor() {
    // @ts-expect-error I guess at some point I have to fix this...
    import('./trash-icon.svg?raw').then((m) => {
      // TO-DO: Avoid using bypassSecurityTrustHtml and install DOMPurify or similar to sanitize the SVG
      const safeSvg = this._sanitizer.bypassSecurityTrustHtml(m.default);
      this._icon.set(safeSvg);
    });
  }
}
