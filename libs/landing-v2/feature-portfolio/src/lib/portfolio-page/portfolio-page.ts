import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { ProjectMemory } from '@portfolio/landing-v2/data-access';
import { TranslatedProject } from '@portfolio/landing-v2/models';
import { DetailPageShell } from '@portfolio/landing-v2/ui';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

const PORTFOLIO_PROJECT_ID = '1';

/** Locale-independent tech chips for the meta panel (0004 content outline). */
const TECH_CHIPS = [
  'Angular',
  'Nx',
  'TypeScript',
  'Module Federation',
  'Docker',
  'k8s',
  'Helm',
  'GitHub Actions',
];

/**
 * "This site, and how it's built." — Portfolio detail page (`/{locale}/projects/portfolio`).
 */
@Component({
  selector: 'lib-landing-v2-portfolio-page',
  imports: [DetailPageShell, RokuTranslatorPipe],
  templateUrl: './portfolio-page.html',
  styleUrl: './portfolio-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortfolioPage implements OnInit {
  private _projectServ = inject(ProjectMemory);

  readonly techChips = TECH_CHIPS;
  readonly locale = RokuTranslator.getLocale();
  readonly backLink = `/${this.locale}`;

  project = signal<TranslatedProject | null>(null);

  ngOnInit() {
    this._projectServ
      .getById(PORTFOLIO_PROJECT_ID, this.locale)
      .subscribe((project) => this.project.set(project));
  }
}
