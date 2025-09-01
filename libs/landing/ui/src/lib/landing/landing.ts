import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

// declare const __webpack_public_path__: string;

@Component({
  selector: 'lib-landing-ui',
  imports: [CommonModule, RouterModule],
  templateUrl: './landing.html',
  styleUrl: './landing.scss',
})
export class Landing {
  // @ts-expect-error For some reason the png module does not work so even tho the IDE shows no error, the compiler does
  hiBubble = import(`../../../assets/hi_bubble.png`).then((m) => m.default);
  // @ts-expect-error For some reason the png module does not work so even tho the IDE shows no error, the compiler does
  odontogramScreenshot = import(`../../../assets/odontogram_screenshot.png`).then((m) => m.default);
  // @ts-expect-error For some reason the png module does not work so even tho the IDE shows no error, the compiler does
  mailIcon = import(`../../../assets/email.png`).then((m) => m.default);
  // @ts-expect-error For some reason the svg module does not work so even tho the IDE shows no error, the compiler does
  githubIcon = import(`../../../assets/github.svg`).then((m) => m.default);
  // @ts-expect-error For some reason the svg module does not work so even tho the IDE shows no error, the compiler does
  linkedinIcon = import(`../../../assets/linkedin.svg`).then((m) => m.default)
  // @ts-expect-error For some reason the png module does not work so even tho the IDE shows no error, the compiler does
  resumeIcon = import(`../../../assets/cv.png`).then((m) => m.default);

  // Used for assets in micro-frontend setup
  // publicPath = __webpack_public_path__ + 'public/';
}
