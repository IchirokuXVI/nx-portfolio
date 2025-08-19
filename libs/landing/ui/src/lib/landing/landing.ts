import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

declare const __webpack_public_path__: string;

@Component({
  selector: 'lib-landing-ui',
  imports: [CommonModule],
  templateUrl: './landing.html',
  styleUrl: './landing.scss',
})
export class Landing {
  publicPath = __webpack_public_path__ + 'public/';
}
