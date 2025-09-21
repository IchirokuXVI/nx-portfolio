import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'lib-loading-icon',
  imports: [CommonModule],
  templateUrl: './loading-icon.html',
  styleUrl: './loading-icon.scss',
})
export class LoadingIcon {
  @Input() size: 'sm' | 'md' | 'lg' | 'xl' = 'md';
  @Input() sizeMultiplier: 1 | 2 | 3 = 1;
  @Input() thickness: 'thin' | 'normal' | 'thick' | 'extra-thick' = 'normal';
  @Input() color: string = '#999999';
}
