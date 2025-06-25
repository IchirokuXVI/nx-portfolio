import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

declare const __webpack_public_path__: string;

@Component({
  selector: 'app-landing',
  imports: [CommonModule],
  templateUrl: './landing.component.html',
  styleUrl: './landing.component.scss',
})
export class LandingComponent {
  publicPath = __webpack_public_path__ + 'public/';
}
