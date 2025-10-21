import { CommonModule } from '@angular/common';
import { Component, inject, signal, ViewChild } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Component({
  selector: 'lib-edit-icon',
  imports: [CommonModule],
  templateUrl: './edit-icon.html',
  styleUrl: './edit-icon.scss',
})
export class EditIcon {
  _icon = signal<SafeHtml | null>(null);

  // @Input() size: 'sm' | 'md' | 'lg' | 'xl' = 'md';
  // @Input() sizeMultiplier: 1 | 2 | 3 = 1;

  private _sanitizer = inject(DomSanitizer);

  @ViewChild('iconContainer', { static: true }) iconContainer: any;

  constructor() {
    // @ts-expect-error I guess at some point I have to fix this...
    import('./edit-icon.svg?raw').then((m) => {
      // TO-DO: Avoid using bypassSecurityTrustHtml and install DOMPurify or similar to sanitize the SVG
      const safeSvg = this._sanitizer.bypassSecurityTrustHtml(m.default);
      this._icon.set(safeSvg);
    });
  }
}
