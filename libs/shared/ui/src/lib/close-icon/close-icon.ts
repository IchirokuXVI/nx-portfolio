import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'lib-close-icon',
  imports: [CommonModule],
  templateUrl: './close-icon.html',
  styleUrl: './close-icon.scss',
})
export class CloseIcon {
  @Input() size: 'sm' | 'md' | 'lg' | 'xl' = 'md';
  @Input() sizeMultiplier: 1 | 2 | 3 = 1;
  @Input() thickness: 'thin' | 'normal' | 'thick' | 'extra-thick' = 'normal';
  @Input() color: string = '#444444';
}
