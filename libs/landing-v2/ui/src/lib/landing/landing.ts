import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  TranslatedInfoFact,
  TranslatedProject,
} from '@portfolio/landing-v2/models';
import { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';
import { Hero } from '../hero/hero';
import { ProjectGrid } from '../project-grid/project-grid';
import { SiteFooter } from '../site-footer/site-footer';
import { SiteHeader } from '../site-header/site-header';

@Component({
  selector: 'lib-landing-v2-ui',
  imports: [SiteHeader, Hero, ProjectGrid, SiteFooter],
  templateUrl: './landing.html',
  styleUrl: './landing.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Landing {
  compReady = signal(false);

  projects = input<TranslatedProject[]>([]);
  facts = input<TranslatedInfoFact[]>([]);

  // @ts-expect-error TypeScript cannot resolve dynamic imports with relative paths in module federation setup
  resumeLink = import('../../../assets/resume.pdf?asset').then((m) => {
    // Remove query parameter from the URL if present
    const url = m.default;
    return url.includes('?') ? url.split('?')[0] : url;
  });

  private _rokuTranslatorServ = inject(RokuTranslatorService);

  constructor() {
    this._rokuTranslatorServ.loaded$.subscribe(() => {
      this.compReady.set(true);
    });
  }
}
