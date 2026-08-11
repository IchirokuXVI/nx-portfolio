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

/**
 * The landing page *body* — hero + project grid. The shared site header and
 * footer live in the routed `Layout` (this component renders inside its
 * <main>), so it no longer carries them itself.
 */
@Component({
  selector: 'lib-landing-v2-ui',
  imports: [Hero, ProjectGrid],
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
