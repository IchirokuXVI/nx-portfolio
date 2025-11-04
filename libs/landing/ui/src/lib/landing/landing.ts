import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterModule } from '@angular/router';
import { TranslatedProject } from '@portfolio/landing/models';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';

@Component({
  imports: [CommonModule, RouterModule, RokuTranslatorPipe],
  selector: 'lib-landing-ui',
  templateUrl: './landing.html',
  styleUrl: './landing.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Landing {
  compReady = signal(false);

  // @ts-expect-error TypeScript cannot resolve dynamic imports with relative paths in module federation setup
  hiBubble = import(`../../../assets/hi_bubble.png`).then((m) => m.default);
  // @ts-expect-error TypeScript cannot resolve dynamic imports with relative paths in module federation setup
  mailIcon = import(`../../../assets/email.png`).then((m) => m.default);
  // @ts-expect-error TypeScript cannot resolve dynamic imports with relative paths in module federation setup
  githubIcon = import(`../../../assets/github.svg`).then((m) => m.default);
  // @ts-expect-error TypeScript cannot resolve dynamic imports with relative paths in module federation setup
  linkedinIcon = import(`../../../assets/linkedin.svg`).then((m) => m.default);
  // @ts-expect-error TypeScript cannot resolve dynamic imports with relative paths in module federation setup
  resumeIcon = import(`../../../assets/cv.png`).then((m) => m.default);

  // @ts-expect-error TypeScript cannot resolve dynamic imports with relative paths in module federation setup
  resumeLink = import(`../../../assets/resume.pdf?asset`).then((m) => {
    // Remove query parameter from the URL if present
    const url = m.default;
    return url.includes('?') ? url.split('?')[0] : url;
  });

  projects = input<TranslatedProject[]>([]);

  private _rokuTranslatorServ = inject(RokuTranslatorService);

  constructor() {
    this._rokuTranslatorServ.loaded$.subscribe(() => {
      this.compReady.set(true);
    });
  }
}
