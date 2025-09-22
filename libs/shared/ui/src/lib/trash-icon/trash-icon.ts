import { CommonModule } from '@angular/common';
import { Component, inject, Input } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';

// @ts-expect-error I guess at some point I have to fix this...
import trashIconSvg from './trash-icon.svg';

@Component({
  selector: 'lib-trash-icon',
  imports: [CommonModule],
  templateUrl: './trash-icon.html',
  styleUrl: './trash-icon.scss',
})
export class TrashIcon {
  _icon = trashIconSvg;

  @Input() size: 'sm' | 'md' | 'lg' | 'xl' = 'md';
  @Input() sizeMultiplier: 1 | 2 | 3 = 1;
  @Input() thickness: 'thin' | 'normal' | 'thick' | 'extra-thick' = 'normal';
  @Input() color: string = '#994040';

  private _sanitizer = inject(DomSanitizer);

  constructor() {
    this._icon = this._sanitizer.bypassSecurityTrustHtml(
      trashIconSvg
    ) as string;
  }
}
