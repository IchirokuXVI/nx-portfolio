import { CommonModule } from '@angular/common';
import { Component, input } from '@angular/core';
import { RouterModule } from '@angular/router';
import { TranslatedProject } from '@portfolio/landing/models';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';

// declare const __webpack_public_path__: string;

@Component({
  imports: [CommonModule, RouterModule],
  selector: 'lib-landing-ui',
  templateUrl: './landing.html',
  styleUrl: './landing.scss',
})
export class Landing {
  // @ts-expect-error For some reason the png module does not work so even tho the IDE shows no error, the compiler does
  hiBubble = import(`../../../assets/hi_bubble.png`).then((m) => m.default);
  // @ts-expect-error For some reason the png module does not work so even tho the IDE shows no error, the compiler does
  mailIcon = import(`../../../assets/email.png`).then((m) => m.default);
  // @ts-expect-error For some reason the svg module does not work so even tho the IDE shows no error, the compiler does
  githubIcon = import(`../../../assets/github.svg`).then((m) => m.default);
  // @ts-expect-error For some reason the svg module does not work so even tho the IDE shows no error, the compiler does
  linkedinIcon = import(`../../../assets/linkedin.svg`).then((m) => m.default);
  // @ts-expect-error For some reason the png module does not work so even tho the IDE shows no error, the compiler does
  resumeIcon = import(`../../../assets/cv.png`).then((m) => m.default);

  // Used for assets in micro-frontend setup
  // publicPath = __webpack_public_path__ + 'public/';

  projects = input<TranslatedProject[]>([]);

  t(s: string) {
    return RokuTranslator.t(s);
  }
}
